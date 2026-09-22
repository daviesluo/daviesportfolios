# Davies' Portfolios

[![CI](https://github.com/daviesluo/daviesportfolios/actions/workflows/check.yml/badge.svg)](https://github.com/daviesluo/daviesportfolios/actions/workflows/check.yml)
[![Edge Functions](https://github.com/daviesluo/daviesportfolios/actions/workflows/edge-functions.yml/badge.svg)](https://github.com/daviesluo/daviesportfolios/actions/workflows/edge-functions.yml)
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

## Contents

- [Highlights](#highlights)
- [Using the board](#using-the-board)
- [Stack](#stack)
- [File map](#file-map)
- [Data flow](#data-flow)
- [Local development](#local-development)
- [Forking / re-using this project](#forking--re-using-this-project)
- [Working conventions](#working-conventions)

---

## Highlights

- **Live prices** — Yahoo Finance via a Supabase Edge Function. Browser
  never touches Yahoo directly, so no CORS or rate-limit-by-IP issues.
- **Agents (crypto auto-trading, paper first)** — an "Agents" page behind
  the ☰ menu: four rulebooks (4h trend following — on BTC/ETH/SOL and,
  since migrations `0039` and `0040`, AVAX and SUI — its 1h variant,
  30-day momentum and relative-strength rotation over BTC/ETH/SOL/XRP)
  across two venues — Revolut X executes at 0 % maker and reads Kraken's candles
  for its signals; Kraken runs the slow rules and paper twins that pay its
  real 0.40 %. The loop runs every minute: quotes, order management,
  protective stops against the live mark and the state on the forming bar
  (shown live on the page); entries wait for closed bars, with TypeSafe's
  **Jev 1.13** decision model as a veto/advice node inside a deterministic
  rulebook and a database-held risk gate with the last word. The basis
  between the venues is recorded every turn: there is no arbitrage to run
  between them, and the record keeps saying so (a one-minute dislocation
  rule that traded that basis was seeded as a measurement, lost on its one
  trade and was retired by migration `0038` — reference §3.5). Positions and P&L are derived from
  fills in one place (`agents` Edge Function); the page leads with a
  scoreboard — deployed, today's change since 00:00 UTC, total, unrealised
  and realised G/L — and opens every strategy in a stacked modal with its
  own scoreboard, a price chart with its buys and sells marked, the live
  state per symbol, its decisions (the words the model saw, what it
  answered, what the rule said), fills and orders. Every strategy starts in
  paper and a live order needs the row flipped, an explicit confirmation
  recorded and the gate. `docs/agents/reference.md` holds the verified
  facts and the measurements behind every design rule, including the ones
  that rule out anything faster than an hour (§3.6) and the bar a coin has
  to clear to join a rule (§3.7, tightened to two walk-forward windows in
  §3.8 after the whole top twenty by market cap was run).
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
  the basis for in-year lots. The **1D** range instead forces every
  holding's basis to `prevClose` (`prevCloseBasis`), so the PORTFOLIO
  line's right edge equals the scoreboard's DAY CHANGE % exactly —
  without it, T212-synced lots (re-dated `today` each refresh) used
  their average cost as the basis and leaked the whole position's gain
  into the day %. Pinned by a vitest suite so the formula can't quietly
  regress.
- **Three views** — football tactics board (default), heatmap (one tile
  per holding, sized by market value, colored by day-change), and a
  PERFORMANCE VS S&P 500 chart with Yahoo-style range buttons.
- **Extended-hours toggle** — switches indices to their futures
  contracts (`^GSPC` → `ES=F` etc.) and recomputes day change against
  the regular-session close so post-market moves show up correctly.
  Non-AH-trading indices (`^VIX`, `^TNX`, `^SOX`) stay on `lastPrice`
  even when Yahoo ships a synthetic `extPrice` for them, so the MC
  cards always match the drill modal. The initial-load prefetch
  pre-warms **both** ext-states' 1D chart caches, so toggling the
  switch is a cache-hit instead of a 1-2 s cold fetch — no manual
  refresh needed. Whenever the toggle is on, the perf-chart legend
  dot flips to `S&P 500 FUTURES` AND the panel title flips to
  "PERFORMANCE VS S&P FUTURES" so the benchmark is unambiguous (both
  revert to "S&P 500" on the cash-index ranges).
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
  keeps every point, 1W keeps every 6th (= 30 min), 1M keeps every
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
  One-time setup: enable `pg_cron`/`pg_net`, set `app.cron_secret` =
  the function's `CRON_SECRET`.
- **1Y range** — trailing-12-month price button, sits right after YTD
  on every ticker / market-conditions modal (a modal-only range; the
  portfolio PerfChart keeps its Jan-1-anchored YTD and isn't given a
  1Y button it has no cost-basis model for). 1y of daily Yahoo bars,
  same MA-50 overlay treatment as YTD.
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
  YTD, never both. Source chain: Yahoo
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
  3M / YTD) gets a gray N-day SMA drawn under the price line,
  labelled `MA 5` / `MA 10` / `MA 20` / `MA 50` in the right
  margin (same position style as the P/E view's 3Y AVG marker).
  Computed bar-based on a same-interval wider history fetch
  (1mo/15m for 1W, 3mo/60m for 1M, 6mo/60m for 3M, 1y/1d for YTD)
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
- **Hide values toggle** — masks dollar amounts with `*` so the page
  is screenshot-safe; percentages stay visible.
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
  "1:1-USD-fallback flashes ~$10 k high, then snaps to real after
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
  Each kind row has an **Acknowledge** button that POSTs to
  `ops-error?action=acknowledge` with the kind name; the server
  marks every matching row in the last-24h window as acked, the
  summary endpoint stops counting them, and the badge's red total
  drops accordingly. Lets the admin clear known-resolved noise
  (e.g. an upstream Yahoo outage already triaged) without waiting
  30 days for the retention sweep. The whole component is gated on
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
  TTL-aligned per range (5 m / 15 m / 1 h / 1 h / 12 h); auto-refresh
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

## Using the board

A short tour of the interactive surface. (Engineering details are
covered further down.)

### Sign in

Two passwords gate the app, each granting a different role:

- `?pwd=<admin>` — full edit mode. Add / remove tickers, edit lots,
  move a holding to another position (EditTickerModal), drag-swap two
  position cards, adjust cash.
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
  every **30 s through the trading week, weekday overnights included**
  (so the T212 overnight quote for US holdings stays live without a
  manual refresh — the T212 call is still capped at ≤1 / s by the
  Edge Function's cache + atomic claim, so neither the 30 s night
  cadence nor a manual click can trip T212's 1-req-per-second limit on
  `/equity/positions`). The MC "today's 16:00-ET close" anchor
  (`fetchTodayRegularClose`, a 5d/5m pull for all 15 MC symbols) is
  fetched at most every 30 min and only outside the regular session
  (its sole consumer is the ext-on anchor; regular hours anchor on
  prevClose). It's **preloaded on market phase, not on the Extended
  Hours toggle** — the toggle deliberately doesn't trigger a refresh,
  so gating this fetch on the toggle left every MC card reading a flat
  0.00 % from the instant ext was switched on until the next 30 s tick
  finally fetched the anchor; phase-gating warms it first so flipping
  ext on is instant. The 30-min throttle is the cost guard — the value
  changes once a day, so re-pulling it every 30 s tick was the egress
  leak that blew the Supabase bandwidth quota (~2.8 GB/day from one
  open tab) in July 2026. The only slow window is the **weekend dead zone**
  — Fri 20:00 ET (after-hours close) through Sun 20:00 ET (overnight
  reopen), `isWeekendDeadZone()` — where nothing trades (not even the
  24/5 overnight session), so it drops to **5 min** to avoid burning
  Yahoo's per-IP budget on round-trips with nothing fresh to show.
  Manual refresh between ticks is always safe — it serves the ≤1 s
  cache when fresh (so a click lands fresh data unless the last upstream
  call was under a second ago) and only the claim winner ever calls T212.

### Tactics board view

- Each card shows a position (GK / CB / CDM / CM / LW / ST / RW …)
  with the holdings assigned to it. The largest position by USD
  value gets the captain's armband; the position with the biggest
  intraday move gets a "hot mover" ball.
- **Tap a card** in non-edit mode → drilldown modal listing every
  holding in that position, sorted by market value.
- **Tap a ticker** in non-edit mode → opens the ticker chart modal.
- **Edit mode** (admin only) — tap a card to add a new ticker; tap the
  GK card to adjust cash; rename a position's group label inline; and
  **drag one position card onto another to swap them** — the slot
  designation (CM / CDM / role / pitch spot) stays put while the
  players (subtitle + tickers) trade places, like two footballers
  swapping positions. Drag uses Pointer Events so it works on touch
  (HTML5 DnD doesn't); a movement threshold distinguishes a drag from
  a tap, and the drop-target card highlights as you hover it.

### Heatmap view

- One tile per non-cash holding, sized by USD market value, coloured
  by today's % change (green up, red down, deeper = larger move).
- **Tap a tile** → opens the same ticker chart modal.

### Holding list + Sectors list + Transaction history + Agents (☰ menu)

- The **☰ menu** to the right of EDIT (both desktop + mobile) opens a
  dropdown with four items: **Holding list**, **Sectors list**,
  **Transaction history** and **Agents**.
- **Holding list** opens a Yahoo-Finance-style sortable table of every
  holding: Symbol (+ company name), Exposure %, Cost Basis, Market Value,
  Day Change ($ / %), Unrealized G/L ($ / %).
- **Sectors list** is the same table grouped by **tactics-board position
  (sector)** — each group header shows the board position + sector name
  (e.g. `ST · Neocloud`) and the sector's aggregate columns, with its
  holdings nested beneath. The sort applies at **both levels**: the
  default exposure-desc orders the sectors *and* the holdings inside each;
  switching columns (or toggling a direction) re-sorts both. Same columns
  as the Holding list.
- Both tables export **copy** (TSV) + **download** (`.xlsx`); the workbook
  now carries a **column-header autofilter** so the export is sortable /
  filterable in Excel just like the on-screen headers. The Sectors export
  is flat with a leading **Sector** column (no interleaved group rows) so
  that filter works across the grouping.
- **Transaction history** opens a chronological ledger (most recent
  first) of every buy lot + sell record across all holdings —
  **including closed positions** (a holding sold to net 0 is taken off
  the board but kept in `portfolio.holdings` so its history survives).
  Each row is Date · Symbol · BUY/SELL · Shares · Price · Amount in the
  holding's native currency; a headline **total Realized G/L (USD)** sums
  the gain banked across every sale. Multiple entries on the **same day**
  are ordered by when they were actually recorded (newest first), not
  alphabetically. Built by `transactions.js` (pure ledger + accounting
  helpers), rendered by `transaction_history.jsx`.
  Sells are recorded in the edit modal (see below) under the **net-cash
  cost-basis model**: a sale's realized P&L folds into the remaining
  average cost (sell high then rebuy lower → lower AC), and net shares =
  buys − sells drive the board's market value.
- Every column header sorts asc/desc on click (default **Exposure %,
  high → low**). Reads straight off the live `metrics`, so it's always
  in sync with the board / heatmap and opens instantly (no fetch).
  **Tap a symbol** → the ticker chart modal (which stacks over the
  list, so closing it returns to the list rather than home). On mobile
  the Symbol column is frozen (sticky-left) so the right-side numbers
  stay tied to a company as the table scrolls horizontally.
- Two icon buttons next to the title **copy** and **download** the
  whole table — header + every row in the current sort order, formatted
  exactly as displayed (`holdings_export.js`). Copy puts TSV on the
  clipboard (pastes straight into Excel / Sheets); download emits a
  real `.xlsx` (a hand-rolled, dependency-free OOXML zip — no
  spreadsheet library in the bundle). Exports use the real values; the
  hide-values mask is a screen-only privacy overlay and isn't exported.

- **Agents** is the crypto strategies page. It opens on a **scoreboard**
  in the home page's cells — DEPLOYED (the value held), TODAY (the day's
  change since 00:00 UTC: realised since midnight plus the move in what is
  held from the day's open, computed by the server), UNREALIZED G/L and
  REALIZED G/L (no total, by the owner's choice), each money figure with
  its percentage beside it in the "+$1,521 (+0.86%)" style — over one line
  naming the bases (paper capital; percentages on capital, unrealised on
  the cost of what is held) and the fees paid. Below it the **venue split**: a share bar (venue and
  share only) and one card per account whose head is two lines — the badge,
  then "N strategies · N live · maker/taker …" — over funded (every balance
  the venue reports, in its own currency: a UK Kraken deposit is pounds),
  deployed, paper capital (the strategies' notional, which is why it can
  exceed the real balance), today, unrealised, realised and fees, on the
  scoreboard's bases. The **strategies** table has one row per strategy —
  a status dot at the left of the name (green running, amber stale, grey
  paused; its words in the title), the name with a sub-line ("N open ·
  $cap"), venue badge (blue Revolut X, violet Kraken), mode badge (LIVE /
  PAPER / PAUSED), TODAY, UNREALISED G/L (on cost), REALISED G/L (on
  capital) and NEXT (the countdown to the bar close, "2h 13m"); on a phone
  the same rows are cards. No small-caps eyebrow above any menu page's
  title (Holding list, Sectors list, Transaction history, Agents and its
  strategy pages), by the owner's choice. **What keeps the dot lit
  is the observation, not the decision**: the loop writes the state it sees
  on the forming bar every minute, so a 4-hour rule reads as running
  between its decisions; without observations it falls back to the
  decision clock (two of the rule's own bars).
  Clicking a row opens the strategy as a **second modal stacked on the
  list**, the way a holding opens its ticker chart on the home page: the ✕
  at the top right closes it and the list is exactly where it was, at the
  same scroll. Its head carries the running dot and a countdown to the next
  decision to the second — the countdown owns its one-second clock, so only
  those characters re-render each second, not the chart and tables under
  it; then the strategy's own scoreboard (deployed, today, unrealised,
  realised, over its capital and fees) with the held positions as tiles; then **LIVE STATE** — one row per symbol of the
  latest observation as pills (trend, strength, breakout, volatility,
  momentum, position, unrealised, time held) with "changed 40 s ago" or
  "unchanged for 33 min" beside it, because the words are written down only
  when they change. Below it the **price chart**: symbol tabs (opening on
  the pair that is held), the signal venue's closes as a 2px line in that
  venue's hue over a faint high–low band, **buy marks (up triangle, green)
  and sell marks (down triangle, red)** at the fills with a 2px surface
  ring, any resting order as a dashed segment at its price from its
  timestamp to now, the average cost as a dotted line, three to five
  recessive gridlines on one y axis, UTC times under it, and a crosshair +
  tooltip (time, close, any fill under the cursor). Two mark kinds means a
  legend, so the row under the chart names them in words. Then the
  **fills** for that pair (time, side as the same triangle, price, size,
  notional, fee, venue badge, maker / taker) with a line summing the
  window, positions (venue, size, average cost, mark, value, unrealised,
  realised, fees), the decision log (UTC time, symbol, the categorical
  state the model saw, what the rule said, what was done, P(healthy),
  caution, provider and latency, whether the risk gate allowed it) and the
  order log (resting post-only limits with their venue badge, fills, fees,
  mode) with a "Load full history" button. No description paragraphs, no
  backtest section, no notes beside section titles, no caps / Jev strip and
  no basis table, by the owner's choice — the backtests live in
  `docs/agents/reference.md` and the basis in `agent_basis`. The app
  fetches the dashboard once after first paint and every strategy × symbol
  chart behind it, 200 ms apart, so the page and every pair open drawn; it
  refreshes every minute while open; scrollbars are hidden; the strategy
  table is a fixed layout that fits the modal; the hide-values toggle masks
  money the same way as everywhere else.
  Before the agents migration has run the dashboard answers
  `{ notReady }`, and the page renders that as a designed "not deployed
  yet" state — the reason and one line about the tables arriving with the
  merge — rather than an error.
  Everything shown is computed by the `agents` Edge Function
  (`?action=dashboard`, `?action=chart`); the page only formats.

### Ticker chart modal

- **Range buttons**: 1D / 1W / 1M / 3M / YTD / 1Y plus an optional
  **P/E 1Y** for stocks with positive trailing EPS and the three
  big US indices (`^GSPC` / `^NDX` / `^RUT`, via ETF-proxy P/E).
  Loss-makers (pre-profit companies) get a parallel **P/S 1Y**
  button in the same slot — mutually exclusive with P/E, so the
  modal always surfaces whichever valuation metric is meaningful
  for that ticker. CN funds (6-digit codes) and `.PVT` private
  holdings only show the daily ranges (1M / 3M / YTD / 1Y) since they
  don't trade intraday on Yahoo. ETFs / futures / non-major
  indices / crypto / forex don't show either button.
- **Opens for any board surface** — clicking a tactics-board player,
  a heatmap tile, or a Market Conditions card all route through the
  same modal. Indices / futures / forex / yield tickers render with
  a context-appropriate y-axis label (no currency prefix; `%` suffix
  for `^TNX`; 4-decimal places for FX pairs); the modal title shows
  a friendly name (e.g. "S&P 500 ^GSPC") for non-equity tickers.
- **Copy / save screenshot** — two icon buttons next to the close
  button (so every individual-stock *and* Market Conditions chart gets
  them) capture the modal window as a PNG. Copy puts the image on the
  clipboard; save downloads it on desktop and, on mobile, opens the
  native share sheet so it can go straight to the photo album. Capture
  runs through `html2canvas-pro` (the `-pro` fork parses the theme's
  `oklch()` palette), lazily `import()`-ed so it ships as its own chunk
  loaded only on click — out of the main bundle (115 KB gate untouched)
  and out of the SW precache (runtime-cached on first use instead).
- **1D view** spans the trailing 24 h with two dashed markers:
  `CLOSE` at the previous regular close and `OPEN` at today's open.
  Tickers with **no US-style extended hours** — foreign listings
  (`.L` / `.HK` / euro) and OTC ADRs (SFTBY / MRAAY), per
  `isRegularSessionOnly` — trade one session a day, so they drop the
  `OPEN` marker and show only the previous session's `CLOSE`, placed at
  that market's own close time via a date-boundary walk
  (`findPrevSessionCloseIdx`) rather than the US 16:00-ET rule that never
  matches their bars. The displayed % is "since previous close" —
  anchored at the official regular close (`regularMarketPrice`), the same
  denominator `computeMetrics` uses — so it matches the scoreboard's DAY
  CHANGE and every heatmap tile exactly, ext-on included. While the modal
  is open the chart polls back-to-back (5 s minimum gap) so intraday bars
  trickle in without a manual refresh.
- **P/E 1Y view** uses the trailing-1Y daily price series and divides
  every bar by the ticker's TTM EPS as of that bar (from Yahoo
  `fundamentals-timeseries`' `trailingDilutedEPS`, rescaled to USD
  for ADRs via `normalizeEpsHistoryToUsd`) — P/E steps visibly on
  report days instead of mirroring the price chart. Modal header
  swaps "PRICE / Last $price" for "P/E RATIO / P/E ratio (price ÷ TTM EPS)"
  so the basis is explicit. A horizontal dashed gray line at the
  3-year average P/E (mean of the three most-recent annual P/E
  values from Finnhub) gives a cycle-aware reference; the value is
  labelled in the right margin outside the plot area so it never
  crosses the price line.
- **Hover** anywhere on the chart for a crosshair: dashed lines down
  to both axes, a tooltip showing the price at that bar, and the %
  change from the anchor.
- **Other ranges** (1W / 1M / 3M / YTD) are pre-fetched in the
  background after every refresh, so range-button clicks usually
  hit the cache and render instantly.

### Performance panel — two charts, one slot

The panel header carries a `⇄` button. It swaps between two views of the
same window; the range carries across, because the user is looking at one
window and asking two questions about it.

**Both views run the identical pipeline** — the same fetch, the same
grid, the same `computeAt` call. Only the drawing differs. That is
structural, not incidental: the Investment view's Value line *is* the
vs-S&P view's portfolio series, expressed in dollars instead of a
percentage, so the two panels cannot report different numbers for the
same book on the same day. An earlier attempt gave the second chart its
own reconstruction of the portfolio; the two drifted, and the screen
showed two different portfolios at once.

#### Investment Performance (the `⇄` view)

- **Value** — `computeAt(...).value`, the book in USD. Its right-hand
  end is the scoreboard's PORTFOLIO cell.
- **Deposited** — net money paid in (`deposit_series.js`): cumulative
  lot cash minus sale proceeds, plus board cash, over the same board
  scope the value line uses. Drawn dashed, as a **step function** — it
  moves on a buy or a sale date and nowhere else. It does **not** follow
  live FX (see `depositFxRates`), because a pound spent in April bought
  a fixed number of dollars and re-converting it every render made the
  line move on days no money changed hands.
- **Legend** — each line's own move across the window as a percentage.
  Not a gain figure: neither line measures a gain, and the
  difference-between-the-lines number that used to sit there was
  removed on request.
- **Axis** — dollars, and deliberately NOT anchored at zero. A $167k
  book against a $129k deposit line would spend three quarters of the
  chart's height getting down to $0 and flatten both lines into the top
  edge. Gridlines, x labels, hover crosshair and range buttons are the
  same ones the vs-S&P view draws, because they are literally the same
  code.
- **Provenance** — the stretch to the left of the first recorded
  5-minute sample is a reconstruction from the ledger and Yahoo's bars,
  not something anyone wrote down at the time. It is drawn faded, with a
  dotted `RECORDED` rule at the handover, and its crosshair readings
  carry a `~`. As `snapshot-record` accumulates, that boundary walks
  left and more of the window becomes recorded fact.
- **Preload** — both views read the same caches, which the background
  prefetch warms for every range (including the recorded prices). There
  is no separate fetch path to be cold: opening the panel, or switching
  range inside it, paints from cache on the first render.

### Performance vs S&P 500 panel

A two-line chart comparing the portfolio's % return against the
S&P 500 over the same range buttons.

**Every range is anchored at the window's own first bar**, 24H included.
The panel's shortest window is a trailing 24 h measured from its first
point, so anchoring it on yesterday's close (which is what
`buildTickerSeries`'s day-chart branch does, and what the ticker modal
still wants) reports the change in return-vs-previous-close rather than
the window's move: on a fixture whose book went $2,500 → $2,900 — a
clean +16.00 % — the panel read **+14.81 %** while the Investment view
of the same window read +16.00 %. Two numbers for one quantity, on one
screen. `PerfChart` passes `anchorAtWindowStart`; nothing else does.

**Both lines start the window at 0 %, on every range.** The panel
answers "how did these two move against each other over the window I
am looking at", and that only has an unambiguous answer when both are
measured from the same instant — the window's own first point. The
S&P used to be anchored on a previous close (1D) or the prior
year-end close (longer ranges) while the portfolio started at 0, which
put a step into one line the other never saw. The shortest button is
therefore labelled **24H**, not 1D: it is a trailing 24 hours, not a
session measured from yesterday's close, and it will NOT equal the
scoreboard's DAY CHANGE. (The ticker-detail modal's 1D is a different
chart and keeps its previous-close marker.) **1W is a real trailing
168 hours**: Yahoo's `5d` means five *trading sessions* (Mon 09:30 →
Fri 16:00 = 4.3 days), so 1W downloads a month at 60m and trims
client-side.

With the Extended Hours toggle
on, BOTH 1D and 1W swap `^GSPC` for `ES=F` (S&P futures) so pre/post-
market and overnight moves are visible — the legend dot AND the panel
header both flip to `S&P FUTURES` (from "S&P 500") so the benchmark is
named correctly (`PerfPanel` owns the range so the title can react to
`spSymbolFor`). 1W additionally pulls Yahoo pre/post
bars (the `1w-ext` fetch variant) so the week carries the extended
sessions, not just RTH. The 1D view draws an `OPEN` dashed marker at
today's regular open in both sub-modes; ext-on additionally renders a
`CLOSE` marker at today's regular close so the user can see the
boundary between RTH and after-hours. ES=F bars are normally clipped
to extended trading hours (4 AM – 8 PM ET) so the chart doesn't
include Asia-daytime bars where stocks aren't trading; ^GSPC bars are
clipped to RTH only. **Whenever the ext toggle is on that clip is
lifted** (gated on the toggle, NOT the live overnight phase) so the
futures line runs continuously through 20:00–04:00 ET — and because the
portfolio line is sampled at the S&P series' timestamps, each holding's
Yahoo bars are spliced with the server-recorded overnight points (T212
samples via `overnight-fetch`, the same source the per-ticker modal
draws) so the portfolio line carries a real overnight curve rather than
a flat carry-forward. This means last night's overnight stays drawn all
through the next trading day (pre-market, RTH, after-hours), not only
live in the overnight session — the recorded points sit in the middle of
the window with the session's real bars on both sides. The 1D anchor
stays phase-aware (prevClose during RTH), which is the correct baseline
for the whole 24 h window since the overnight happened after that close.
Holdings that don't trade overnight (CN funds, `.L` ETFs) simply hold
flat through the night. Hover the chart for a crosshair: vertical dashed line, dots on
both lines, per-series % chips next to each dot, and a date pill at
the bottom — bare time on 1D, **date + time on every intraday range
(1W / 1M / 3M)** so the pill pins the exact bar incl. the overnight,
date-only on YTD. 3M joined that set when it went to six points a day:
a bare date would have labelled six consecutive points identically.
The rule is `crosshairFormatFor` in `ticker_chart_helpers.js` and is
shared with the ticker modal — the modal used to inline its own
`1W || 1M` test, so when 3M went intraday only the panel's pill grew a
time. The pill clamps to the chart edges so it never overflows past
the live point on the right.

### Market Conditions

The left column's grid of indices / commodities / FX cards is fully
clickable — tap any card to open the same chart modal individual
stocks use, with the full 1D / 1W / 1M / 3M / YTD / 1Y range row. `^GSPC`,
`^NDX` and `^RUT` additionally surface a **P/E 1Y** button (sourced
from the matching ETF's trailing P/E via Finnhub) with a 3-year-
average dashed reference line. Yields render with a `%` suffix, FX
pairs at four decimals, and indices / futures without a currency
prefix so the y-axis matches each instrument's natural scale.

### Sidebar

- **Top Movers** — the largest **actual** winners and losers, up to
  five each, over a window you pick, ranked either way from a `%` / `$`
  switch in the panel's title row. `%` asks what moved; `$` asks what moved the
  *book* — `dayChange`, the position's USD move against the same
  baseline the heat map uses — and the two orders genuinely differ: a
  7.9 % pop on a small holding tops the percentage list and sits near
  the bottom of the dollar one. Both read the fields `metrics.js`
  already computes, so neither list can drift from the other or from
  the tile for the same ticker. The choice persists in `dp.prefs`
  beside `hideValues`. Each row carries a magnitude wash behind the
  text, scaled against the largest absolute move across **both**
  columns — per-column scaling would draw a −$50 top loser as wide as
  a +$462 top winner and misreport the shape of the day. Dollar
  figures mask under the hide-values eye; percentages don't.
  Membership is the same in both modes: only names that really moved
  rank — a row pinned at 0 — a no-US-ext venue suppressed during the
  overnight (SFTBY / `.L` / euro / CN fund) or a genuinely flat stock
  — pads neither column (the overnight LOSERS list used to be five red
  0.00 % rows); an em-dash marks a side with no movers. The sub-50¢
  cut-off is the one thing the metrics don't share: it applies to the
  dollar list only, so a small holding that really moved 6 % keeps its
  percentage row and stays consistent with its green heat-map tile.

  **The window** — `TODAY / 1W / 1M / 3M` — is a second tab group in
  the panel's TITLE row, sitting against the heading where the old
  `· TODAY` suffix did, because it finishes the panel's name: this is
  TOP MOVERS, over this window. The `%` / `$` measure switch stays at
  the far right, in the same idiom the performance panel uses for its
  view switch — two unrelated choices, so they read as two rather than
  as one clump in the corner.

  **A longer window measures the HOLDING period, not the stock.** A
  position opened two days ago shows two days of move on the 1M list,
  not a month of the share price. The panel does not implement that
  rule: `computeAt` already applies it per lot for the performance
  chart — a lot bought before the window opens carries the window-start
  close as its basis, one bought inside it carries its own cost — so
  `holdingMoveOver` asks `computeAt` about a single holding and reads
  the answer back instead of writing a second version of the same
  arithmetic. Sales, FX, a missing price history and a ticker with no
  series at all come along for free. 3M is offered again only because
  of this: while the panel measured the STOCK it was actively
  misleading over a quarter, and it was removed for exactly that.
  TODAY deliberately does NOT go through the rule — a day change is
  measured against yesterday's close for every holding regardless of
  when it was bought, which is what the heat map, the scoreboard and
  the tactics chips all show, and re-basing it on purchase cost would
  put two different numbers for one ticker on one screen. TODAY is
  the live day move `metrics.js` already publishes; the longer windows
  are priced from the per-range history the performance panel already
  prefetches, anchored by the same `buildTickerSeries(...,
  anchorAtWindowStart = true)` call the chart uses — so "NVDA over 1M"
  means one thing in this sidebar, and the feature costs no extra
  network. A name whose history hasn't landed yet doesn't rank, and the
  column says `loading…` rather than `—`: "the cache is still filling"
  and "nothing moved" are different statements. Its dollar figure is
  the window's price move valued on **today's** holding, deliberately
  not a P/L attribution — a position opened mid-window didn't earn the
  whole move, and the number that accounts for that is the performance
  panel's, which walks the lot ledger. Window and metric both persist
  in `dp.prefs`, and both are tablists with roving tabindex and arrow
  keys off one shared handler. A window saved before the set shrank
  falls back to TODAY. The window tabs are `.movers-window .view-tab`,
  NOT the chart's `.perf-range-btn`: while both answered to one
  selector a click meant for the chart landed on whichever came first
  in the DOM — the chart on desktop, the sidebar on a phone.
- **Formation Value** — every position's USD weight as a horizontal
  bar plus its day P/L.
- **Upcoming Earnings** — the next three future earnings dates across
  the user's holdings, sorted ascending. Date + time format `03 Jun ·
  BMO` / `· AMC` / `· HH:MM` depending on what Yahoo's
  `calendarEvents.earnings` exposes for each ticker. Sits at the
  bottom of the left column on desktop and after the mobile MC strip
  on phones. Powered by the `fundamentals` Edge Function with the 2 h
  `stock_fundamentals_cache` doing the heavy lifting.

### Mobile layout

Below the 1020 px breakpoint the page collapses into a single column
in this order: Header → Pitch / Heatmap → Sidebar → Market Conditions
(3 × 3 grid: indices / commodities + yield / FX) → footer.

The PWA update banner is safe-area-aware on iOS so it doesn't crash
into the notch / status bar; the hide-values mask uses a vertically-
centered bullet (`•`) instead of `*` so masked rows stay flush with
neighbouring real numbers on the same line.

When any modal is open the body is pinned with `position: fixed` and
the page-scroll offset is restored on close. Without this iOS Safari's
bouncy overscroll pulled the home page out from under the modal as
soon as a finger drag crossed an edge of the dialog. Same lock pattern
is used by every charting platform / Bootstrap / Material UI.

Heatmap tiles auto-wrap long tickers (`BMNR` → `BM`/`NR`) and
auto-shrink the font on cramped tiles so 4-char symbols stay legible
without being clipped to `BM…`.

### Install as a PWA

The app is a PWA — on iOS / Android, "Add to Home Screen" gives a
full-screen launcher with the proper icon. When a new version is
deployed, a top-of-screen banner offers a `RELOAD` button; the SW
won't auto-reload mid-session. The button calls
`updateServiceWorker(true)` for the standard `controllerchange`
path but also schedules a hard `window.location.reload()` 1.5 s
later as a belt-and-suspenders fallback — iOS Safari (and some
standalone-PWA Chrome contexts) don't fire `controllerchange`
reliably, so without the second reload the click felt silently
unresponsive.

If the user doesn't click `RELOAD`, the banner auto-fires the same
handler after 1 h. `registerType: 'prompt'` was kept (autoUpdate
wiped the `?pwd=…` URL mid-login), but the user-visible deferred
update used to sit indefinitely — a long-running tab could drift
months behind the deployed bundle. 1 h is well past the auth
round-trip (the user has a sessionStorage token long before then,
so reload doesn't re-prompt) and tight enough that nobody is more
than one workday behind the latest deploy. The SW itself also polls
`/sw.js` for updates every 10 min so a long-running tab discovers
new builds without needing the auto-reload to fire — combined worst-
case stale window: ~70 min (poll + auto-reload).

Click → reload also stashes `dp.swReloadAt = Date.now()` in
sessionStorage and the freshly-mounted page reads it on first paint
to suppress the banner for 2 min, so iOS Safari's flaky SW state
bookkeeping doesn't immediately re-show the same notification right
after the reload (the "click did nothing" loop the user kept hitting
before this guard landed).

---

## Stack

- **iOS status bar** — the installed PWA asks for an **opaque** status
  bar (`apple-mobile-web-app-status-bar-style: black`). It used to ask
  for `black-translucent` and paint its own background up through the
  bar; iOS 26 draws a glass scrim over that band, which washed out the
  app title and the clock row. No CSS or meta controls the effect
  (Safari 26 ignores `theme-color` and derives edge colours itself), so
  the only fix is to stop asking for a translucent bar.

  That trades the scrim for a SEAM: the system's bar is pure `#000` and
  the page's first pixel was the radial glow's `#14201b`, which butted
  together is a hard line under the clock. So under
  `@media (display-mode: standalone)` the page starts black too and
  climbs out of it — a 96px ramp whose stops approximate an ease-out,
  because a linear fade ends on a corner and the corner is itself a
  faint line. It is a `position: fixed` layer (`body::before`,
  `z-index: -1`), NOT a `background-attachment: fixed` on `body`: iOS
  slides a fixed-attachment background along with the content during
  the rubber-band, which dragged the ramp's black head into the middle
  of the screen on a pull-down and met the revealed canvas colour as a
  hard edge. `overscroll-behavior: none` there too, so the rubber-band
  stops revealing the canvas at all. The header's own 3 % cream sheen is dropped there as
  well: it starts on the page's very first row and lifted it to about
  `#090909`, which on an OLED (where `#000` is the pixel off) still
  reads as an edge. Measured on the rendered page: first row `0,0,0`,
  largest step between adjacent rows 2/255. The full-screen mobile
  modal gets the same ramp for the same reason.

  `.app` also takes `env(safe-area-inset-top)` exactly there, instead
  of the usual `max(8px, env − 8px)`: the system has already reserved
  that band, and stacking the app's own 8px under it would move the
  header down. To go back, restore `black-translucent` in
  `src/index.html` and delete the two standalone blocks in
  `styles.css`.
- **Frontend** — React 19 + Vite 8, JSX with `checkJs` + JSDoc for type
  safety (no `.tsx`). Bundle output to `dist/` (`/assets/*.js` once
  published), which is the only directory Cloudflare Pages serves. Runtime deps stay minimal (`react`,
  `react-dom`, `idb-keyval`); the one heavyweight, `html2canvas-pro`
  (chart-modal screenshots), is `import()`-ed lazily so it never lands
  in the main bundle.
- **Backend** — Supabase (Postgres + Edge Functions, Deno runtime).
  Nine functions: `auth`, `data`, `prices`, `chart`, `fundamentals`,
  `ops-error`, `trading212`, plus `overnight-record` / `overnight-fetch`
  (the cron-driven overnight intraday recorder). Migration files
  `0001`–`0016`; `0005`/`0006` are a historical create/drop pair for the
  retired `analyst_estimates_cache` table.
- **Build / CI** — Vite production bundle, vitest for unit tests
  (`jsdom` environment so component-level tests on `TickerChartModal`
  / `PerfChart` / `App` mount with `@testing-library/react`), tsc in
  `--noEmit` mode for typechecking. Three GitHub Actions workflows:
  `check.yml` (typecheck + tests + build on every push), `edge-functions.yml`
  (deno test + auto-deploy of changed `supabase/functions/<name>/index.ts`
  on push to main), `migrations.yml` (PR-time SQL lint, push-to-main
  `supabase db push` applying any new migration files against prod's
  `schema_migrations` table).
- **Hosting** — Cloudflare Pages auto-deploys from `main`. `_headers`
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
  to precache; (2) `src/chunk_recovery.js` — a page chunk that fails to
  load refreshes the browser's copy, drops every service worker and cache,
  reloads once and reports `chunk.load`, and each page has its own
  boundary that shows the page's frame with the words instead of a
  whole-app RENDER ERROR; (3) the sweep answers a chunk with the poisoned
  response and asserts the heal, and the scheduled health check fetches
  the live shell, verifies every chunk it references is JavaScript and
  that a chunk that does not exist is a 404 without an immutable header.

---

## File map

### `src/` — client

| File | What it does |
|---|---|
| `main.jsx` | React entry point. Mounts `<App>` + service-worker registration. |
| `app.jsx` | `<App>` (auth gate) + `<Board>` (the actual UI). Owns portfolio state, `doRefresh` loop, modal coordination. **`portfolio`'s `useState` is cache-primed** from `Storage.loadPortfolioCache()` (`storage.js`) instead of starting `null` — first paint shows the user's real board (and fires the FIRST `doRefresh` against it) immediately, instead of waiting on `loadPortfolioRemote()`'s own network round trip; the real load still always runs and reconciles the moment it resolves. Two follow-on wrinkles the cache-priming introduces, both handled: (1) the debounced auto-save effect is gated on `hasRealLoadRef` (flips true only once the REAL `loadPortfolioRemote()` reply lands) so it can never fingerprint-seed, replay a pending sessionStorage draft, or save against the optimistic cached snapshot — only ever against the same authoritative data it always ran against before cache-priming existed; (2) the refresh-loop effect keys off the stable boolean `portfolio !== null` (deliberately, so a fresh portfolio object from every 30 s price tick doesn't re-fire the whole effect / reschedule the timer) — with cache-priming that boolean is already `true` on the first render, so it never *flips* again once the real load lands, meaning it wouldn't auto-notice and refresh the just-loaded real holdings on its own; `hadCachedPortfolioRef` + `realLoadArrived` explicitly force one extra `doRefresh` in exactly that case, via a small effect declared right after `doRefreshRef`'s own sync effect so it observes the freshly-recreated `doRefresh` closure (same-commit ordering — calling it directly inside the load-effect's `.then()` would still see the STALE cache-closing `doRefresh`, since `setPortfolio` doesn't apply synchronously inside a promise callback). If the real load resolves to the seeded demo portfolio (a genuine failure) while a real cache-primed portfolio is already on screen, the demo book is NOT shown — keeps the real (if briefly stale) holdings visible instead. Integration-tested in `app.test.jsx` (cache-primed refresh fires before the real load resolves; a second refresh fires once it does; no save in between). | The five click-only modals — ticker chart, holdings list, sectors list, transaction history, agents — are `React.lazy` chunks rather than part of the main bundle, **each in its own Suspense boundary** (a shared one with a null fallback let any page's first render blank every open modal and show the home page through — the Agents "flash"); the four menu pages fall back to `ModalFrame`, the page's own backdrop, title and close with "Loading…", so a click before the chunk arrives shows the page's chrome and never the home page; every lazy page also sits in its own `LazyBoundary`, which renders the same frame with the words (and a Reload button) when the chunk fails twice, reporting `chunk.load` rather than `render.crash`, so one broken page never becomes a whole-app RENDER ERROR; the warm-up imports swallow their own failures, since the click's `lazyPage` is where a bad chunk is healed and reported. The split took the bundle from 121.03 kB gzipped (0.97 kB of headroom) to 109.07 kB. They are NOT lazily fetched: a `setTimeout(…, 0)` after first paint warms all five, so the code is in memory long before any click and the `Suspense fallback` is `null` because reaching it requires clicking inside the first moments of a cold load. `npm run verify:browser` asserts the five chunks appear in `performance.getEntriesByType('resource')` before any modal is opened — a lazy modal that fetched itself on click would be the same defect as a panel that paints an empty state and fills in after.
| `agents.jsx` / `agents.js` / `agents_chart.js` / `agents.test.js` | The Agents page (☰ menu → Agents), a `React.lazy` chunk prefetched like the other modals. `agents.js` is the pure half: `fetchAgentsDashboard` / `fetchAgentsLog` / `fetchAgentsChart` (token-gated calls to the `agents` Edge Function), `strategyRows` (one overview row per strategy: unrealised G/L on cost, realised G/L on capital, today, next decision), `strategyStatus` (**a reading in the last three minutes means running — `observationAgeMs` over `positions[].observation`; without one it falls back to the decision clock, `DECISION_STALE_MS` per rulebook**; its `tone` — running / stale / paused — is the colour of the dot beside the name), `nextDecisionText` (the countdown `untilText` without its "in"; "every minute" for a minute rule), `observationView` / `liveStateRows` / `observationAgeText` (the state words as pills with their tone, the age in seconds), `defaultChartSymbol`, `fillRows` / `fillsSummary`, `totalsView`, `scoreboardView` / `strategyScoreboard` / `glText` (the scoreboard cells: deployed, today on capital, total, unrealised on cost, realised on capital, each as "+$1,521 (+0.86%)"), `venueRows` (the per-venue split, share, today and balances), `venueHue` (the two badge colours the chart line also wears), `agentsAlerts` (everything that stops a strategy trading or leaves it unprotected, said out loud above the table: the global pause, a venue fault, a live row on a keyless venue, **a live row while `live_confirmed_at` is null** — the state in which the loop refuses every live order — **a paused row still holding a position**, since the tick skips paused rows so no stop, trail or exit runs on what they hold, and **a live order left `pending` past two minutes**, whose outcome the loop deliberately will not guess at and a person settles from the venue's history), `newestWins` (the dashboard's refresh is race-safe: the minute's interval and a click can be in flight together, and only the newest answer reaches the screen or the module cache), `sizeText` (position, order and fill SIZES go under the hide-values mask beside the money — a size next to an unmasked mark is the value), `lastChangeText` (one phrasing down the live-state column), `symbolOrderRows` (every order on ONE pair, newest first, priced by its fill where there is one and widened rather than duplicated when the full history is loaded — it replaced a fills view, a positions table and a decisions view that said the same things three times), `orderView`. `agents_chart.js` is the detail chart's geometry, DOM-free so it can be pinned: `chartGeometry` (time scale, price range padded 8 %, close path, high–low band, gridlines, x ticks, fill marks, resting-order segments, the average-cost line), `londonParts` / `fmtChartStamp` / `fmtChartTime` (**every time these pages print is UK LOCAL time, the clock the site's header shows, because the loop's UTC and the reader's own clock on one screen is the bug; `Intl` resolves BST and GMT and the month comes from this file's table, since `en-GB` writes "Sept" where the rest of the site writes "Sep"**), `hoverPoint` (nearest candle + any fill under the cursor), `tooltipBox` (kept inside the plot, flipped at the right edge), `markPath` (the buy / sell triangles), `priceTicks` / `niceStep` / `fmtChartPrice` / `fmtChartTime` / `fmtChartStamp` / `windowText`. `agents.jsx` renders the scoreboard, the venue split, the pause / fault banners, the strategy table (cards on a phone, `useMediaQuery`; `NameCell` puts the status dot beside the name), the `notReady` and error states, and the per-strategy detail as a second modal stacked on the list (its own scoreboard, `Countdown` on its own one-second clock, position tiles, live state, symbol tabs, the SVG chart with a crosshair, the fills table, positions, decisions, orders) — closed by its ✕, so the list keeps its scroll. `prefetchAgentsDashboard` (called from `app.jsx` after first paint) warms the dashboard and every strategy × symbol chart, 200 ms apart, so the modal and every pair open on a cached copy (`readAgentsCache` / `readChartCache`); `balanceLines` names every reported balance in its currency; `countdownText` is the to-the-second countdown. No chart library: the SVG is inline and sized by a `ResizeObserver`. Nothing is computed client-side that could disagree with the server. |
| `auth.js` | Password → HMAC token flow. `collectPassword` (URL `?pwd=` or `window.prompt`), `authenticate` (POSTs to `/auth`), `decodeAppToken` (skip prompt if a valid sessionStorage token already exists). |
| `portfolio_remote.js` | `loadPortfolioRemote` / `savePortfolioRemote` against the `data` Edge Function. Both write-through the resolved portfolio to `Storage.savePortfolioCache` (a real, non-demo row only) — the first-paint cache `app.jsx`'s `useState` initializer seeds from, so a fresh server load AND the user's own edits keep it current. Includes `migrate(p)` for legacy portfolio shapes (CB → CB1/CB2 split, BRK-B move, currency backfill, lots backfill — the latter stamps TODAY, not a hardcoded 2025-01-01: lots are the YTD chart's source of truth and a pre-Jan-1 date means "held since last year", so the constant silently recategorised every backfilled holding as a prior-year position each year after 2025) plus a load-time heal for "sold out but never closed" holdings — any holding WITH sells that the BOARD already reads as empty (`shares` ≤ 1e-6) and whose `netPosition` nets to ≤0 is re-closed (marked `closed`, zeroed, stripped from every position's tickers), fixing data saved while the pre-snap float-dust bug kept full sales on the board. **The board's share count wins over the ledger's**: without that guard the heal read a short ledger as a sold-out position and zeroed a real one on every load, silently and unfixably — typing the shares into the edit modal survived until the next reload. PLTR was held that way, its ledger a complete 2024 round trip (6.5 bought, 6.5 sold) while 55 shares sat in the account, and it is not a one-off risk: 16 of 26 holdings on this book carry lots that don't add up to their board shares, so any of them acquiring a sell would have been next. A genuine full sale already writes `shares: 0` through `netPosition`, so every case the heal was built for still heals. Also exports `portfolioUserFingerprint(p)` — a stable string digest of just the user-edited subset (positions + per-holding shares / cost / lots / **sells** / **closed** / currency, with sorted keys for insertion-order invariance — sells and `closed` matter because a CLOSED holding carries shares 0 / cost 0, so without them every fingerprinted field stayed identical no matter what you did to its sell history and correcting a sale on a sold-out position read as a no-op and was dropped) used by `app.jsx`'s debounced save to skip writes when only price-refresh data changed; and broadcasts a `portfolio-saved` message on `BroadcastChannel('dp.portfolio')` after a successful save so other tabs on the same origin can refetch instead of carrying a stale copy. Together those two fix the multi-tab data-loss bug where a backgrounded tab's 30 s price refresh would re-serialise its stale shares/lots-with-fresh-prices snapshot and silently revert an edit made in another tab. **Optimistic concurrency** (per migration 0013): module-scoped `lastKnownVersion` is updated from every load/save response and sent as the `If-Match` header on the next save; on a 412 conflict reply, `savePortfolioRemote` returns `{ ok: false, conflict: true }` and `app.jsx` surfaces a "another tab saved newer changes" banner with Reload / Keep-editing CTAs (the version is also refreshed from the conflict response so a subsequent retry against the now-known version can go through cleanly). The fingerprint + BroadcastChannel close the common multi-tab race; the If-Match path closes the corner cases those don't (offline tab coming back, second device that wasn't subscribed to the channel, network round-trips overtaking each other). |
| `supabase_config.js` | Shared `SB_URL`, `SB_ANON`, `EDGE_AUTH_URL`, `EDGE_DATA_URL`. |
| `positions.js` | `POSITION_COORDS` — the 11 tactics-board slot coordinates on a 100×100 pitch (consumed by Pitch / Heatmap / app.jsx). The last real definition left in the old `utils.js` god-module barrel, which was retired in 2026-06 in favour of direct per-module imports (every consumer now imports straight from `yahoo_fetch` / `historical` / `market_hours` / `storage` / `fx` / `metrics`); `knip` is a hard CI gate now that the barrel's false positives are gone. |
| `portfolio_edits.js` / `portfolio_edits.test.js` | `createPortfolioEditHandlers({ setPortfolio, isReadOnly })` — the six tactics-board edit reducers (updateHolding / removeHolding / swapPositions / moveHolding / addHolding / updatePosition) lifted out of `app.jsx`. Each is `setPortfolio(p => next)`, a pure transform the test exercises by capturing the updater; all no-op in read-only mode. `addHolding` takes a `mode`: `'append'` records an ADDITIONAL buy (new lot appended, shares / avg cost recomputed from the whole lot+sell ledger) and `'replace'` restates the position (lots become just this entry — the `.PVT` revalue flow depends on it). Either way `sells` and `closed` are carried over: the old implementation rebuilt the holding from scratch, so re-adding a ticker you already held silently destroyed its entire transaction history. `app.jsx` asks which one via `useConfirm` when the ticker is already in the book — a **three**-outcome dialog (Add purchase / Replace position / Cancel), because both named actions write and Cancel has to mean "do nothing"; a binary confirm folded Esc, the backdrop and Cancel onto `replace`, the destructive branch. Both modes derive shares and average cost from `netPosition(lots, sells)` exactly as `updateHolding` does, so the tile can't disagree with the ledger, and a buy that restores a positive position clears `closed`. |
| `storage.js` | `Storage` namespace (`dp.auth` / `dp.prefs` / `dp.schema` / `dp.marketCache` / `dp.portfolioCache` / `dp.opsErrorAck`) with single-version schema migration. `loadMarketCache` / `saveMarketCache` persist the last successful `fetchTickers` reply (FX pairs + MC tickers) and hydrate the next cold start so the portfolio total + MC cards paint correct values on the first frame instead of flashing 1:1-USD fallbacks. `loadPortfolioCache` / `savePortfolioCache` are the same pattern for the FULL portfolio (positions + holdings) — written after every successful `loadPortfolioRemote` / `savePortfolioRemote` (`portfolio_remote.js`), read by `app.jsx`'s `useState` initializer so first paint shows the user's real board immediately instead of a blank "Fetching board from cloud." screen while the real load is still in flight (30-day staleness cap; the real load always reconciles moments later regardless). Never persists a seeded demo row (`_isDemo`) — a network hiccup on load must never seed a stranger's data as the user's own on the next cold start. Chart caches (`dp.tickerChart` / `dp.maCache` / `dp.ytd`) live in IndexedDB via `chart_store.js` to escape the localStorage 5 MB quota; this module only carries the small / low-churn rows that stay under it (so `writeJSON` just returns false on the now-very-unlikely quota error — the old "halve the largest chart row and retry" fallback became dead once the bulk caches moved to IDB). `loadMarketCache` (7-day expiry + legacy `dp.fxCache` fallback + per-row validation), `saveMarketCache`, `loadPortfolioCache` / `savePortfolioCache` (round-trip, demo-rejection, staleness boundary, malformed-row guards), and `migrate` are pinned by `storage.test.js`. |
| `market_hours.js` | DST-aware time helpers (`londonTimeParts`, `centralEuropeTimeParts`, `usMarketPhase`, `ukTzAbbr`, `usMarketHoursUtc`, `lseIsOpen`, `euroExchangeIsOpen`, `isUsMarketHoliday`), plus the 3M chart's sampling grid (`LONDON_SLOT_HOURS`, `londonHourUtcMs`, `usCloseUtcMs`, `fourHourSlots` — six samples a weekday at 01 / 05 / 09 / 13 / 17 London and the day's actual US close, which is 21:00 London except in the ~4 weeks a year the UK and US are in different DST regimes and it falls at 20:00; the grid asks `usMarketHoursUtc` per day rather than writing 21:00 down). All `Intl`-based so DST cutovers are resolved by the runtime. `usMarketPhase` returns `overnight` (market closed) on weekends AND full-day NYSE holidays — `isUsMarketHoliday` computes the calendar rule-based (nth-weekday + fixed-date with the correct weekend-observance shift, New-Year's-on-Saturday exception, and Good Friday from Easter) so there's no date list to maintain and, by construction, no chance of mislabelling a real trading day as closed. Half-day early closes (~3/yr) are NOT modelled — those are genuinely open, just until 13:00 ET. `lseIsOpen` / `euroExchangeIsOpen` gate the ext-hours toggle in `metrics.js` for venues with no US-style pre/after session. **Both are Mon-Fri**: until 2026-09-20 they read the clock alone, on a comment's reasoning that a weekend guard was redundant “because Yahoo returns no new bars then, so the pct stays at the prior close”. That stale pct is the bug rather than a reason there isn't one — the gate reported the venue OPEN at 14:01 CET on a Saturday, so the board painted Friday's move as an after-hours number: SIVE (2DG.SG) read +6.13 % with the toggle on while the price recorder had it unchanged at 2.804 since 21:05 London the previous evening, 28 hours stale. Each gate now reads the weekday in its OWN zone (a viewer in Asia can already be on Saturday while London is still trading Friday), and an unrecognised weekday name falls through as a weekday so a locale surprise can only leave the gate as permissive as before. European / UK public holidays are still not modelled: they need a per-venue calendar, and blanking a real trading day is the worse error. Pinned in `market_hours.test.js` (gate level) and `utils.metrics.test.js` (what the board actually shows, both toggle states). The venues are — every `.L` ticker (VUAA.L / SAEM.L on the T212 sync, plus any user-added London listing) and every euro-zone ticker (`.PA`/`.DE`/`.MI`/… per `isEuroExchange`) shows 0 % when its own exchange is closed and the live local pct only while it's actually trading. CN mutual funds (6-digit 天天基金 codes, `isCnFund`) are suppressed to 0 % too while the toggle is on, but **unconditionally** — no exchange-clock gate — since their `gsz` is a once-daily NAV estimate, not a US-overnight trade, so 017731 stops showing a stale green tile (and polluting Top Movers) beside the SFTBY / `.L` / euro zeros. `euroExchangeIsOpen` uses one 09:00–17:30 CET window (`Europe/Paris`) that covers Euronext / XETRA / Milan / Madrid / Vienna / Helsinki / Athens. **`foreignSessionIsOpen(ticker)`** wraps both behind one question — "is this non-US listing's own exchange trading right now?" — and is the single source of truth for two rules that must agree: `computeMetrics` suppressing a foreign row's ext-hours pct to 0 while its market is shut, and the chart modal's 1D anchor. They had drifted: with the market open the heatmap showed SIVE (2DG.SG) moving while its modal read 0.00 %. |
| `proxy_chain.js` | The 5-host public CORS-proxy list + per-proxy backoff cache (`proxyIsAvailable`, `markProxyDead`, `clearProxyBackoff`). When a proxy returns 429 / 403 / 5xx it's blacklisted for 10 minutes (1 minute for plain timeouts), so one dead host doesn't poison every 30-second refresh tick. Cleared on first successful response from that proxy. In-memory only; resets on page reload. Also exports `mapWithConcurrency`, the bounded fan-out (6 tickers at a time) both fallback callers use — each ticker's fallback races all 5 proxies at once, so an unbounded 30-ticker map fired ~150 simultaneous fetches when the Edge Function was down, enough for Chromium to reject them with `ERR_INSUFFICIENT_RESOURCES` and fail the refresh outright (pinned in `proxy_chain.test.js`). Imported by `yahoo_fetch.js` + `historical.js`. |
| `yahoo_fetch.js` | The live-price pipeline. Edge-first (`/functions/v1/prices`) with the per-proxy fallback chain consulted only for tickers Edge dropped. Public surface: `refreshPrices`, `fetchTickers`, `fetchFundamentals`, `extPriceFromCandles`. **The proxy fallback derives `extPrice` from the intraday candles** (`extPriceFromCandles` — most recent candle outside the exchange-local 9:30-16:00 window, the same rule the Edge Function applies server-side). It used to read `meta.preMarketPrice ?? meta.postMarketPrice`, but Yahoo's v8/chart `meta` no longer ships either field at any interval/range, so that was hard-null for every ticker: any time the app fell back to the proxies, every US equity lost its ext quote, `extPriceIsRealAh` went false, and computeMetrics' ext branch forced the row to exactly 0.00 % — the whole US side of the board flatlining at +0.00 % with Extended Hours on while crypto / non-US rows (which never take the ext path) still showed real moves. The fallback request also moved from `interval=1d&range=5d` to `interval=5m&range=1d&includePrePost=true`: daily candles carry no pre/post bars, and that request had no usable `previousClose` either — only `chartPreviousClose`, which on a 5-day window is the close from FIVE sessions ago (NVDA 195.04 vs the correct 211.94), so every proxy-served `dayPct` was silently a multi-day move. `refreshPrices` also guards on **coverage**: a tick that returns quotes for under half the requested tickers reports `source: 'error'` instead of `live`. Without it, an unreachable Edge Function plus a CN fund in the book produced a "successful" tick from one cached fund quote — the header read LIVE / "Last updated 2 s" while every other holding kept its previous value, so an outage looked like a frozen-but-healthy board. `fetchOneYahooChart` (the proxy-side single-symbol fallback) now suppresses `extPrice` for any ticker with a dotted suffix (`.L`, `.HK`, `.SS`, …) — Yahoo's `preMarketPrice` / `postMarketPrice` for those reflects the local exchange's live intraday quote, not a US-style pre/post session, so the ext-hours toggle would otherwise leak real LSE intraday movement when the user expects 0. `fetchOneYahooChart`'s proxy fallback now RACES every available proxy in parallel (mirrors `historical.js`'s `fetchHistorical` design) instead of falling through them sequentially — the old sequential loop's worst case was `PROXIES.length × 8 s` (≈40 s for 5 proxies) whenever the first few tried happened to be dead, the dominant contributor to a cold session's "first refresh takes tens of seconds" (proxy backoff state is in-memory and resets every page load, so a fresh tab always starts blind); the race drops the worst case to ≈ the slowest live proxy's own timeout. **CN funds** (6-digit codes) the Edge response omits are special-cased: their `fetchOneCNFund` proxy fallback (also a parallel race now) runs entirely in the BACKGROUND — the refresh returns the quotes it has immediately, and a background success is cached (`20 min` NAV TTL, 60 s retry cooldown) and merged into the next tick. Awaiting it inline was the "first refresh takes ~20 s / reopen slow again" bug: fundgz geo-blocked server-side + a sequential proxy walk client-side, re-paid on every page load because the proxy backoff is in-memory. Multi-ticker fan-outs also pass `skipIfAllDead` so tickers after the first wave don't re-race proxies the wave just benched. Pinned in `yahoo_fetch.test.js` (hung first proxy doesn't block a later winner; losing racers aren't benched; CN fund never blocks the refresh; background success merges next tick; benched-proxy waves are skipped). |
| `historical.js` / `historical.test.js` | Chart-data fetch. `fetchHistorical` (single-symbol proxy race), `fetchCnFundHistoryViaProxy` (danjuanapp + xueqiu race for 6-digit CN funds), `fetchHistoricalBatch` (Edge-first, proxy-fallback only on Edge total failure), `fetchTodayRegularClose` (latest 16:00 ET close per ticker for the MC cards' "since 16:00 ET" anchor — an expensive 5d/5m pull, so `app.jsx` throttles it to ≤ once per 30 min and only outside the regular session, preloaded on market phase rather than the ext toggle so flipping Extended Hours on shows real % immediately instead of a flat 0.00 % until the next tick). `trimCnFundToRange` — the per-range trim that makes 1M / 3M / YTD actually differ for CN funds (both proxies return ~500 daily bars regardless) — is pure and pinned by `historical.test.js`. |
| `transactions.js` / `transactions.test.js` | Pure transaction-ledger + accounting helpers (no React). `cleanSells` sanitises sell rows like `cleanLots` does buys (both preserve `src`, which marks a row the Trading 212 rebuild has no claim over — dropping it would hand another platform's purchases to the broker on the next refresh); `netPosition(lots, sells)` returns net shares + net-cash average cost (a sale's realized P&L folds into the remaining basis) — net shares within 1e-9 of zero snap to an EXACT 0, because a fractional full sale (T212-style 0.1 + 0.2 quantities) otherwise nets to ±5e-17 in binary floats and the `shares <= 0` close check never fired (the "sold out but still counted in the header" bug); `realizedGain(lots, sells)` is the banked gain at each sale (chronological, native currency); `toLedgerRows(holding)` / `fromLedgerRows(rows)` fold one holding's buys and sells into a single newest-first list for the lot editor and split them back on save, preserving `ts` and `src`; `buildTransactionLog(holdings)` flattens every holding's buys + sells into one most-recent-first ledger (closed holdings included; cash and the two auto-invested ETFs `VUAA.L` / `SAEM.L` excluded). `withClosedFromFills` in `t212_fills.js` feeds it the tickers the board no longer carries at all, synthesised from `t212_orders` — on this book that is 41 tickers and ~950 executed trades (NFLX 105, IREN 96, CRCL 70, SOUN 70), every one a real decision and all of them invisible while the log could only walk `holdings`. Those two were first hidden because their lots were a synthetic stand-in the sync rewrote daily — no longer true, and it changes nothing: the reason to hide them was never that the rows were fake but that they are cashback and spare-change auto-invest, 155 fractional buys nobody decided on, which bury the trades the owner actually made. Same-day rows are ordered by the optional `ts` (epoch ms stamped when the row was added in the editor, preserved through `cleanLots` / `cleanSells`), newest entry first — lots/sells store only a `YYYY-MM-DD` date, so without it same-day rows fell back to alphabetical-by-ticker; legacy rows that lack `ts` keep that stable fallback below the timestamped ones. `totalRealizedUsd(holdings, fxRate)` sums realized G/L across currencies into USD (same exclusions). The headline example (buy 10@100, sell 10@120, rebuy 10@90 → 10 sh @ AC 70) is pinned. |
| `transaction_history.jsx` / `transaction_history.test.jsx` | `<TransactionHistoryModal>` — the ☰-menu Transaction history view. Reads `portfolio.holdings` directly (not `metrics`) so closed positions still show; headlines the USD realized total and tables every buy/sell with a BUY/SELL badge, native-currency price + amount, masked under the hide-values toggle. Header carries the same **copy** / **download** export buttons as the Holding list (`transactionRowsToMatrix` → `<TableExportButtons>`). Columns lead with **Type**, and every header sorts on click — descending, ascending, then back to the log's own newest-first order, because without that third state there is no way back short of closing the modal (`sortTransactionRows` / `nextSortState`). Two final columns say what the row DID to the position, both fed by `annotateLedger` in `transactions.js`, which walks each holding in order because neither figure can be read off the row itself. **Avg Cost** is what the position cost per share once that row had happened — filled for sales too, since the cash a sale returns comes off the basis of what's left, and blank once a position closes out. **Realised G/L** is what a sale banked, with the percent it made on what those shares cost; blank on a purchase, and amount-only on a sale out of a zero-cost position. Styled by `.txn-table`, which borrows the Holding list's `.hl-*` scaffolding but not its proportions — that table is a row per holding, this one is every trade ever made, so density is the job: the defaults wrapped `2026-07-22` onto two lines, doubling every row so eighteen showed eight, and ran 760px wide on a 356px phone. Tabular figures, a green/red rail down the left edge that survives sorting by any other column, and **below 760px each trade becomes a three-line card** — every field kept, laid out what/how-much, when/size/price, basis/banked — with the header row replaced by a row of sort chips driving the same cycle. A **Symbol still on the board opens its chart**; one that was closed out stays plain text, since there is no holding behind the modal and an affordance that leads nowhere is worse than none. |
| `t212_fills.js` / `t212_fills.test.js` | Rebuilds a holding's lot ledger out of Trading 212's executed fills. `brokerLedgerFor(orders, ticker)` is that ticker's fills in `{ lots, sells }` shape; `rebuildLedgerFromFills(holding, orders, ticker)` returns the ledger as it should be — everything marked `src: 'other'` kept, everything else replaced by the fills — or **null meaning "leave this holding alone"**; `applyFillLedgers(holdings, orders)` runs it across the board on every refresh tick and reports which tickers changed; `ledgerProvenance` is what the lot editor says about the result. Replacement rather than row-by-row reconciliation because the two records don't correspond: the board carried ONE lot of `59 @ 144.31` for SPCX, which is T212's average price and not a trade that ever happened, while the twelve real fills ran 165.58 down to 115.48 over a month — matching row against row can only ever double-count that. Two rules keep it safe: a ticker is only rebuilt when it carries a `t212Shares` tag — or reads zero shares, since Trading 212 stops reporting a position once it's closed and those were the ledgers missing most (NET showed eight purchases and not one sale against a board reading zero) — AND the broker has fills for it, so a CN fund or a cold wallet is untouchable, and **the result must net to the share count already on the board** or nothing is written — which is how a half-walked backfill leaves the ledger exactly as it found it. `shares` is never touched — the guard already refused anything that wouldn't net to the board's count — but **`cost` follows the rebuilt ledger**. The board's own figure is T212's `averagePricePaid`, the average of what was BOUGHT, which says nothing about what was sold; this app's basis is the net-cash model the owner specified, where a sale's realized P&L folds into what the kept shares cost. On a holding only ever bought the two agree to the cent (eight of them do here); on ORCL — sold down from 123 fills to 70 shares — they differ by $28.68/share, and leaving both would put a different average cost in the lot editor than on the board for the same holding, forever. Re-applied on every tick because the position sync writes its own average first. |
| `table_export.jsx` | `<TableExportButtons getMatrix filenameBase disabled>` — the shared copy (TSV → clipboard, with the legacy `execCommand` fallback + ✓/✕ feedback) / download (`.xlsx`) header buttons. Used by the Holding list, Sectors list, and Transaction history so the export paths can't drift; `getMatrix()` returns the `[header, ...rows]` matrix at click time. |
| `holdings_list.jsx` / `holdings_list.test.jsx` | The ☰-menu **Holding list** table. Pure `buildHoldingsRows(metrics)` flattens `metrics.positions[].players` into one row per holding (cash excluded; exposure = mv / total, costBasis = shares·cost·fx, unrl derived) and `sortHoldingsRows(rows, key, dir)` sorts; both pinned. `<HoldingsListModal>` renders the sortable table (default exposure desc) and calls `onTickerClick` to open the chart modal. Header has **copy** (TSV → clipboard) + **download** (`.xlsx`) icon buttons (`holdingsRowsToMatrix` → the shared `<TableExportButtons>`). `COMPANY_NAMES` is a static ticker→name map (no client name source for equities; unknown → "--") — also rendered by the ticker chart modal as the full-name row above Mkt Cap, so extend it as holdings change. The column set `COLUMNS` is exported so the Sectors list renders the identical columns. |
| `sectors_list.jsx` / `sectors_list.test.jsx` | The ☰-menu **Sectors list** — the Holding-list table grouped by tactics-board position (sector). `buildSectorGroups(metrics)` builds one group per non-empty, non-cash position (`{ label, subtitle, role, agg, rows }`, the aggregate columns summed from its members so the header equals the rows beneath it); `sortSectorGroups(groups, key, dir)` sorts at BOTH levels — sectors by the group aggregate (or the sector name for the Symbol column), holdings within each by the same column — never mutating the input. `<SectorsListModal>` renders bold sector-header rows with the holdings nested + indented, reusing the Holding list's `COLUMNS` + `.hl-*` styles, and exports via `sectorGroupsToMatrix` → the shared `<TableExportButtons>`. |
| `holdings_export.js` / `holdings_export.test.js` | Pure, dependency-free export helpers shared by all three table modals. `holdingsRowsToMatrix(rows)` builds the 9-column Holding-list matrix; `sectorGroupsToMatrix(groups)` builds the flat Sectors-list matrix (a leading **Sector** column + the same 9, one row per holding, no group rows); both format every cell with the SAME `fmtMoney` / `fmtPct` the tables render. `matrixToTsv` joins for the clipboard; `matrixToXlsx` packs a minimal valid OOXML workbook by hand (stored zip + CRC32, every cell an inline string) so no spreadsheet library lands in the bundle — and now emits an `<autoFilter>` over the header+data range so Excel shows sort/filter dropdowns on every column (Holding list, Sectors list, Transaction history alike). |
| `icons.jsx` | Shared monochrome inline-SVG icons (`IconCopy`, `IconDownload`, `IconCheck`, `IconX`) for the header icon buttons — `currentColor` strokes so they pick up the chalk theme. Used by the Holding list export buttons and the chart-modal screenshot buttons. |
| `screenshot.js` / `screenshot.test.js` | Modal-screenshot helpers. `captureNodeToPng(node)` rasterises a DOM node to a PNG via a lazily `import()`-ed `html2canvas-pro` (separate chunk; oklch-aware). `copyNodeImage` writes an `image/png` ClipboardItem built around the still-pending capture (Safari-activation-safe); `saveNodeImage` routes to the Web Share sheet on a coarse pointer (→ photo album) and a file download on desktop, with a download fallback. |
| `screenshot_actions.jsx` / `screenshot_actions.test.jsx` | The chart modal's copy/save screenshot buttons. Finds its own `.modal` panel via `closest()`, tags the action group `screenshot-skip` so html2canvas omits the chrome, and gives copy transient ✓ / ✕ feedback. |
| `overnight_intraday.js` / `overnight_intraday.test.js` | Client read/cache layer for the server-side overnight recorder (the actual sampling is `overnight-record` on pg_cron). `fetchOvernightSeries(tickers)` hits `overnight-fetch`, mirrors the result to localStorage (`dp.overnight.cache`) + fires an `overnight:fetched` event; `getOvernightSeries(ticker)` is the synchronous cache read so the modal paints instantly; `mergeOvernightSeries(series, pts, ctx)` is the pure splice: it clusters the recorded points into contiguous overnight SESSIONS (a >3h gap between consecutive points = a new night), lets each session's `[start,end]` span be OWNED by the recorded T212 5-min samples, and keeps every Yahoo bar OUTSIDE all spans — before the first session, in the daytime gaps BETWEEN sessions, and after the last — then sorts the union. The inter-session gap is the important bit: the 26h fetch can hold last night's tail AND tonight with a full RTH day between, and an earlier plain before/after splice around `[firstRec,lastRec]` deleted that middle RTH (opening a chart in the live overnight then showed ONLY the overnight, no RTH); keeping the daytime bars in the gap draws yesterday's session too, and during the day the recorded overnight sits in place with the session's real pre/RTH/post bars around it (only ext-on [the TOGGLE, **any phase** — not just the live overnight session] + overnight-session ticker + 1D/1W/1M + ≥2 in-window points; otherwise returns the series ref unchanged so the single-heartbeat-dot path is the no-regression fallback). **A dead-flat overnight is dropped** (all recorded closes identical → the market was CLOSED for that session: US holiday / weekend / holiday-eve, when the recorder keeps sampling T212's frozen last close): a flat carry-forward conveys nothing and reads as "still trading", so the merge returns the series unchanged and the chart ends at the last real bar — the modal's dot is likewise held back on a holiday (`isUsMarketHoliday`) / weekend (`isWeekendDeadZone`). A genuinely trading overnight always varies, so this only ever drops a frozen line — a display-side safety net independent of the calendar; the `overnight-record` cron now also skips full-day holidays at the source (it always skipped weekends), so fresh frozen points stop being written, and the client suppression covers any still in the 26 h window. On 1W / 1M the merge step-samples the 5-min points to the range's bar cadence (`barIntervalMs` in ctx — 30 min / 60 min from `NIGHT_BAR_INTERVAL_MS`, → every 6th / 12th point), always appending the live tail so the line still ends at "now"; otherwise the ~130 overnight points would crowd today's index-axis on those views and visually swallow the multi-day trend (right ~50% / 25% of the chart). It deliberately does NOT cut at "the last Yahoo bar" — Yahoo now returns sparse overnight prints for the most liquid names (NVDA/ORCL) but not others (GOOG), which made the old `> lastBarDate` filter draw the line only for tickers Yahoo had no overnight data for. `app.jsx` warms the points as part of the page-entry + manual-Refresh preload wave (fired in parallel with the price/MC/chart fetches and `await`ed before `setLastUpdated`, so the cache is guaranteed hot by the time the user sees the refresh complete; also re-fired on every overnight auto-tick); `ticker_chart_modal.jsx` derives `displaySeries` from the merge, also fetches its own ticker on open as a backstop, suppresses the dot when the line is present, and keeps the rightmost point live. `perf_chart.jsx` is the second consumer: whenever the ext toggle is on (any phase) it `fetchOvernightSeries`-es every portfolio ticker and merges each one's points into its Yahoo bars before the YTD aggregation, so the "Performance vs S&P 500" 1D / 1W portfolio line carries the same overnight curve through the next trading day (the benchmark side rides ES=F futures). |
| `chart_modal_geometry.js` / `chart_modal_geometry.test.js` | Pure geometry for the ticker chart modal: anchorClose selection (regular / ext-mode fallback chain to lastPrice / prevClose / series[0]), `hasData` gate, `xOfIdx` / `yOf` scale fns, y-range containment for PE/PS 3yAvg + MA + VWAP + the overnight-dot price, "nice step" y-tick spacing, and index-spaced x-ticks (+ the "now" tick at the live dot's true-time x). Lifted out of `ticker_chart_modal.jsx` in PR #158 — the inline block had grown to ~200 lines that needed to be touched in 8 different positions during PR #157's SFTBY / `.PVT` saga. Pinned by 13 vitest cases.  The ext-on 1D anchor takes `anchorRefs.anchorAtPrevClose`, set for a foreign listing whose own exchange is mid-session: there `lastPriceAny` is a RUNNING quote rather than a completed close, so the normal "anchor at today's regular close" rule divides the price by itself and prints a permanent 0.00 %. Anchoring at prevClose gives the live local-session move — the same basis `computeMetrics` puts on the tile for that row. Pinned in `chart_modal_geometry.test.js`. |
| `chart_geometry.js` / `chart_geometry.test.js` | Shared SVG-chart helpers used by both `perf_chart.jsx` and `ticker_chart_modal.jsx`. `pointerToDataIndex(event, svgEl, geom, dataLength)` replaces the duplicated 20-line `handleMove` math (mouse + touch coord extraction, SVG letterbox correction, axis-padding clamp, round-to-nearest-index) so a bug fix in one chart propagates to the other automatically; `geom.xDenom` optionally overrides the x denominator when the bars don't fill the full width (the modal's overnight view reserves the right edge for the live dot's time-proportional gap). `overnightTrailingGap(lastBarMs, nowMs, barIntervalMs)` returns how far past the last bar the live "night market" dot sits, in bar-interval units, so the otherwise index-based chart honours real elapsed time for just the current overnight session. `overnightDotWithinReach(lastBarMs, nowMs)` is the companion guard — false once the last real bar is more than one overnight session (10 h) back — which suppresses that dot on the Sunday / post-holiday reopen, where the newest Yahoo bar is Friday's ~48 h-old close and the time-proportional gap would otherwise fling the dot far off the right edge past a giant blank span (the "weekend big gap"). `pointsToSvgPath` is also exported, plus `parseChartDateUTC` (append the missing `Z` to the 16-char intraday date so non-UTC users don't read every bar an hour early), `findRegularCloseIdx` (the strict `closeHh:closeMm` backward walk for the regular-close anchor / CLOSE marker), `findRegularOpenIdx` (today's first at-or-after-open bar for the OPEN marker, scoped to the latest calendar day so yesterday's afternoon bars AND any spliced overnight points — UTC 00:00-08:00, before the open — can't steal the match; the modal calls it on the overnight-spliced `displaySeries`, the same array the markers are rendered on, so the OPEN/CLOSE markers don't drift onto an overnight sample once last night's recorded line shifts today's bars right), and `findPrevSessionCloseIdx` (market-agnostic previous-session close via the calendar-day boundary, for the foreign / ADR 1D CLOSE marker where the US-close-time rule doesn't match) — lifted here from the byte-identical copies `perf_chart.jsx` + `ticker_chart_modal.jsx` had inline. vitest pins the letterbox math, the `xDenom` override + gap edge cases, the date parse, and the regular open / close searches. |
| `chart_store.js` | IndexedDB-backed chart cache layer built on [`idb-keyval`](https://github.com/jakearchibald/idb-keyval). Three logical stores — `ChartStore` (per-ticker per-range chart series + the `\|FUND\|v3` fundamentals row + the `\|PE\|v5\|...` series), `MaStore` (MA overlay wider-history per ticker × range), `YtdStore` (PerfChart's per-(year, range, ticker) entries). Each store has a synchronous in-memory `Map` mirror that's auto-hydrated from IDB at module load so the modal's `useState` initializer can read warm cache on the very first paint. Writes update the mirror immediately and persist to IDB in the background (best-effort). One-shot legacy-`localStorage` migration on first hydrate copies any existing `dp.tickerChart` / `dp.maCache` / `dp.ytd` rows into the matching IDB store, then deletes the localStorage row to free the quota for `dp.auth` / `dp.prefs`. Falls back to mem-only cleanly when `indexedDB` is undefined (vitest, private-mode iOS Safari). `pruneAllChartStores(maxAgeMs=30d)` evicts entries older than the horizon (delisted tickers, stale phase/variant permutations) — called once after the module-load hydrate and at the tail of every prefetch pass, so the three stores stay bounded across a long-lived session instead of growing without limit (the `pruneOlderThan` method existed but was never wired up before 2026-06). |
| `trading212.js` | `fetchTrading212Holdings` (the 30 s server-cached `{holdings, prices}`), `fetchTrading212Orders` / `syncTrading212History` (the executed-fill history and the page-at-a-time backfill that populates it), `lotsFromOrders`, `applyTrading212`, `applyTrading212NightPrice`, `stripClosedFromPositions`. `applyTrading212` **never** replaces the user's lots or sells: a board row can hold the same ticker at T212 and at another broker, and overwriting its ledger with machine history was a production data-loss bug. It keeps the existing lots, tags the broker's slice as `t212Shares` / `t212Cost` so a later refresh applies only that slice's delta, and writes a stand-in lot tagged `source: 't212-synthetic'` only when there is nothing there at all — crucially **without re-dating it to today on every sync**, which is what once made the whole book look bought this morning. Real dates come from `/equity/history/orders` (`/equity/positions` reports a POSITION — quantity and average price, no dates), stored in `t212_orders` and read at chart time. **On the FIRST sync of a ticker** — no `t212Shares` tag yet — the broker is taken as the whole position. Preserving a board excess as an assumed other-broker slice sounds safer and is not: measured on the real book, the board read 24 shares of GOOG against the broker's 22 and had PLTR recorded as sold out while 55 shares sat in the account, and both would have stayed wrong forever. From the second sync onward only the tagged slice's delta moves, so a genuinely split position is built by editing it once. |
| `deposit_series.js` / `investment_view.js` / `price_snapshots.js` | The Investment Performance view's three pure pieces. `deposit_series.js` — net money paid in as of a date, with `t212FillsFor` folding the broker's real executed fills into the dates: cumulative lot cash minus sale proceeds, plus board cash, over the SAME board scope `computeAt` values, so the gap between the two lines is profit rather than an accounting artefact. Deposits are STEPS (they move on a buy or a sale date and nowhere else) and do NOT follow live FX: `frozenFxRate` / `freezeDepositFxRates` store a native→USD rate per currency in `portfolio.depositFxRates` the first time it's seen, and refuse to freeze an exact `1` because that is `fxRateToUSD`'s missing-pair fallback (a CNY position at 1.0 instead of ~0.14 is seven times its real size). Returns `null` rather than converting at a rate it doesn't have. `investment_view.js` — the dollar axis (`niceStep` / `moneyTicks`, which deliberately does NOT force zero onto the axis: a $167k book against a $129k deposit line would spend three quarters of the chart's height reaching $0), `fmtAxisMoney` / `fmtChipMoney`, `windowPct` (each line's own move across the window — what the legend reports, replacing the difference-between-the-lines "gain" figure) and `provenanceSplitIndex`. `price_snapshots.js` — reads the server-recorded 5-minute prices back and folds them into the `{ticker: [{date, close}]}` map Yahoo's history arrives in, so `computeAt` treats a recorded bar and a fetched bar identically. A recorded bar wins a tie (it's this account's own observation, not a vendor figure that can be revised). `recordedBarDate` SNAPS the sample to the range's bar grid on the ranges that draw it as a bar (1D 5 m / 1W 15 m / 1M 1 h): the read bucket guarantees one row per bucket but hands it back at the moment it was written, so a tick near a boundary drifted off the grid — measured live at a 15-minute bucket, the gaps ran 15, 15, 15, 25, 5, 15, 20, and Yahoo's bars sit at :00/:15/:30/:45 while those sat at :05/:25/:50. Flooring is also the honest label, since Yahoo stamps a bar by its start and carries the price at its end. 3M deliberately keeps the true instant — its chart SAMPLES with `closeOn` at the four-hour slot grid, where flooring a 19:55 observation to a 16:00 key would read it as the 16:00 price. |
| `ticker_class.js` — `tradingWeekOf` | New alongside the other shape predicates: how much of the week does this tape actually run? `all` — round the clock, seven days (crypto). `weekdays` — round the clock Monday to Friday, no nightly close (futures, spot FX). `session` — one session a day (indices, listed equities, funds). The 3M chart reads it to pick an x grid: `all` and `weekdays` are drawn on the four-hour London grid over the days they trade, `session` keeps hourly bars because on that grid it would land on two live prices a day and carry the previous close through the other four. The distinction between `all` and `weekdays` is what stops a 24/7 tape losing its Saturday: `fourHourSlots` skips weekends unless told otherwise. |
| `formatters.js` / `fx.js` / `metrics.js` / `lots.js` | The pure pieces lifted out of `utils.js`. `formatters.js`: `fmtMoney` / `fmtPct` / `fmtPrice` / `fmtShares` (share count, configurable decimal cap — default ≤2, no padded zeros) + `fmtSharesFor(n, ticker)` (the per-ticker policy: crypto `-USD` shows ≤3 decimals so small coin balances like 0.043 BTC aren't rounded to "0.04", everything else ≤2) / `pctColor` / `maskDigits` / `formatAgo`. `fx.js`: `detectCurrency` / `currencySymbol` / `fxRateToUSD` (the version that returns `{ rate, missing }` so a 1:1 fallback can be surfaced) / `fxToUSD` (back-compat shim). `metrics.js`: `computeMetrics` / `detectFormation` — the ext-hours gate treats crypto (`-USD`) like a US equity (the prices Edge Function pre-anchors it to the last US close), so BTC's heatmap / scoreboard day change matches a US stock's, and its always-real 24/7 `extPrice` bypasses the ±5% bogus-quote cap; `tickerCount` (the header's "N tickers") is **board-scoped** — distinct non-cash tickers referenced by a position, so a fully-sold holding (kept in `holdings` with `closed: true` for its transaction ledger, but removed from the board) stops counting the moment it's sold out. `lots.js`: `cleanLots` / `totalShares` / `weightedAvgCost` (lot-input sanitisation, which used to be inline in modals.jsx and silently kept negative cost values). All pinned by `utils.metrics.test.js` (37 cases) and `lots.test.js` (14 cases) so the on-screen portfolio numbers can't quietly regress. `formatters.js` also owns `normalizeDecimalInput` (every decimal field in the modals runs its keystrokes through it, so a bare `.5` reads back as `0.5`; it only touches a leading dot, since a half-typed `0.` or `1.` has to survive) plus two shared display predicates: `displayTicker` (heatmap tiles / tactics chips / Top Movers all label a ticker the same way) and **`pctIsFlat`** — ONE "did this actually move" threshold (|pct| < 0.005, i.e. anything that prints as 0.00 %). The heatmap already painted those tiles neutral while Top Movers ranked on a bare `> 0` / `< 0`, so a -0.004 % row was simultaneously a dark "no change" tile and a red LOSERS entry reading "-0.00%". |
| `data.js` | `INITIAL_PORTFOLIO` seed for first-load demo state. |
| `ytd.js` | Pure chart math. `buildTickerSeries`, `computeAt` (sums per-lot value/basis and SUBTRACTS the sales — a ledger of buys alone says a position that was sold down is still whole, and ORCL alone is 123 executed fills netted to 70 shares; a sale before the window's anchor removes its shares at the anchor price, a sale inside it takes its proceeds out of the basis, so six shares left after buying 10 @ 100 and selling 4 @ 130 in one window carry a net cost of 80 — the same figure `netPosition` reports; restricted to **board-scoped** holdings — only tickers referenced by a position, matching `computeMetrics` so an orphaned holding can't split the chart from the scoreboard; with `prevCloseBasis` — passed for 1D — every held lot's basis is forced to `prevClose` and no-prevClose holdings are counted FLAT in the denominator, so the 1D PerfChart right edge equals the scoreboard DAY CHANGE; cash is also added to both value and basis), `ledgerFor` (was `lotsFor`; it returns the sales too, and vets the ledger on its NET position rather than the sum of the buys, which every trimmed holding failed), `closeOn`, `RANGES`, `fetchParamsFor`, `maFetchParamsFor` (per-range wider-history params for the MA overlay; honours the `dailyOnly` override so CN funds / `.PVT` get 1d-only history), `filterToLatestDay`, `filterToLastHours` (trailing-N-hours cut; `filterToLast24h` is the 24 h specialisation), `applyVariantFilter` (the 1D fetch-variant → display-window dispatch — `closed` → latest day, `reg`/`ext` → last 24 h — that `perf_chart.jsx` / `use_ticker_chart_data.js` / `prefetch.js` had inlined at 8 sites). Crypto 1D US-session windows: `windowSinceLastUsClose` (ext OFF + market **open** → from the last 16:00-ET close to now) and `windowBetweenLastTwoUsCloses` (ext OFF + market **closed** → the last complete close-to-close day, ending AT the last close so, like a US stock after hours, the overnight move is hidden). `fillVenueSessionGrid(points, session, nowMs)` lays a sparse-tape venue listing's Yahoo bars onto a fixed 5-min session grid (per venue-local day, DST-safe via Intl), carrying the last close flat through no-trade gaps — the 2DG.F 1D frame that always spans 07:00–21:00 UK (live day capped at "now"; leading slots backfill flat; out-of-frame prints dropped). Decoupled from React so it's unit-testable. | **1W is 15-minute bars** (was 60m): a trailing week held ~35 points against 1M's ~154, so the two buttons drew the same book at four times the density and 1W read as an angular sketch beside it. 15m gives ~130. Five call sites encode that cadence — `RANGES`, `maFetchParamsFor` (the MA overlay is computed in BARS, so a different interval makes "MA20" cover a different span than the bars it is drawn over), `NIGHT_BAR_INTERVAL_MS`, and the modal and shared cache TTLs — and they had already drifted (RANGES said 60m while the MA fetch used 30m). `ticker_chart_helpers.test.js` now asserts all five agree.
| `ytd.test.js` | YTD formula pins (pre-year lot, year lot, mixed, missing janPrice, 1D ext mode anchored at today's regular close, intraday date comparison, etc.). |
| `utils.test.js` | `fetchHistoricalBatch` strategy pins: Edge fast path, "trust Edge omissions" (no proxy fallback when Edge succeeded with a partial response), Edge total-failure → proxy fallback, CN-fund proxy bypass, empty input, dedup. **Note**: the sibling `fetchYahoo` (live prices, not historical bars) takes the opposite stance — when the Edge Function returns a partial set it proxy-retries the omitted tickers, because Yahoo dropping a single FX pair for one tick was the actual root cause of the recurring `FX MISSING` flash (`fxRateToUSD` 1:1 fallback baked into the portfolio total until next refresh). Historical bars don't have that problem so the chart path stays cheap. |
| `ticker_class.js` / `ticker_class.test.js` | Pure regex predicates for ticker shape (`isCrypto`, `isFutures`, `isForex`, `isIndex`, `isExchangeListed`, `isCnFund`, `isPvt`, `isDailyOnly`, `isUsEquity`, `isEuroExchange`). `isEuroExchange` is the single source for the euro-zone exchange-suffix list (`.PA`/`.AS`/`.DE`/`.MI`/… — `fx.detectCurrency` reuses it for EUR detection, `computeMetrics` for the ext-hours gate). Lifted out of `ticker_chart_modal.jsx` / `prefetch.js` / `indicators.js` so the same classification can't drift between three callers (was happening — modal said `BRK-B` is crypto because its earlier regex was just `/-USD$/` instead of `/-USD$/i.test` AND a "doesn't start with `^`" check). Also exports `hasOvernightSession(ticker)` = `isUsEquity` minus an explicit `NO_OVERNIGHT_SESSION` set (`SFTBY` / `MRAAY`) — OTC ADRs that are US-shaped but quote only their regular session, so they're excluded from the night-market heartbeat dot + T212 overnight-price override that would otherwise show their stale close as a fake live quote — and `isRegularSessionOnly(ticker)` = foreign listings (`isExchangeListed`) + those OTC ADRs, which the chart modal uses to drop the 1D `OPEN` marker (single daily session) and mark only the previous close; and `venueSessionFor(ticker)` = the fixed 1D session frame for sparse-tape venue listings (`2DG.F` → 07:00–21:00 Europe/London) that `fillVenueSessionGrid` renders on. |
| `cache.js` / `cache.test.js` | Shared TTL constants (`RANGE_TTL_MS`, `MA_TTL_MS`, `PE_TTL_MS`) + freshness predicate (`isFresh(entry, ttlMs, extraValid?)` with a pluggable per-row check, e.g. `hasAnyNumericField('volume')` for 1D rows that pre-date the volume-bearing Edge Function deploy) + cache-key helper (`tickerChartCacheKey`, the single source of truth for the modal + prefetch). The PE key carries an algorithm-version suffix (currently `v4`) so a breaking change to the PE-series math (e.g. the 2026-05 ADR USD-anchor rescale) can evict every browser's cached series in one push by bumping the suffix, instead of waiting out the 12 h TTL. Soft LRU (`trimLru`) is still here but only used for legacy localStorage rows during migration — IDB-backed caches don't need it. Also owns `loadRangeCache` / `saveRangeCache`, which fold `YtdStore`'s flat `y${year}|${range}|${ticker}` keyspace back into one (year, range) bucket — they live here rather than in the performance panel because Top Movers reads the same rows to price its non-TODAY windows, and `CHARTS_UPDATED_EVENT` / `announceChartsUpdated`, which the background prefetch fires per range so the sidebar (which has no fetch of its own) fills the moment a range lands instead of on the next 30-second refresh. |
| `indicators.js` / `indicators.test.js` | Pure indicator math lifted out of the chart modal: `maBarsFor` / `maLabelDaysFor` / `rollingSma` / `computeMaSeries` (MA overlay), `vwapSessionResetFor` / `vwapSessionKeyOf` / `computeVwap` (per-asset anchor + cumulative VWAP + forward-fill smoothing), `priceDividedByTtmEps` (TTM-history-aware ratio series — drives both P/E and P/S), `hasExtendedHoursBars` (the SFTBY/OTC bogus-extPrice detector), `extPriceIsRealAh` (the shared "is the upstream `extPrice` a real ext-hours trade, or a sentinel that should fall back to `lastPrice`?" verdict used by both the VIX-class MC cards and the drill modal so they can't disagree about which price to render) and `ahQuoteTolerance`, the distance it allows between the quote and the last bar. **That tolerance follows the tape rather than a fixed number**: the two figures come from different fetches, so the gap between them is elapsed time, not error — a flat 3 % asks "did this move more than 3 %", which on a quiet name means "is this quote from somewhere else" (what we want) and on a fast one just means "yes, it is moving" (what we don't). BE ran 8.96 % across 2026-09-04's after-hours with one 8.76 % five-minute bar, its quote landed 3.16 % from the last bar for the ordinary reason, and the guard called a real print fake — the heat-map tile went to an em dash while every slower holding beside it read fine. Now twice the largest step in the last hour, floored at the original 3 % so nothing is looser than before and capped at 15 % so one freak print can't switch the guard off. The SFTBY case still fails: its padded bars are flat, so its tolerance stays at the floor. Every function takes plain arrays so it can be pinned by vitest without spinning up React — the modal was the single largest source of subtle math regressions in this codebase and every fix had been risking silently breaking another ticker class because the conditions were tangled with rendering state. |
| `header_sidebar.jsx` | `<Header>` (scoreboard + extended-hours toggle + hide-values eye), `<Sidebar>` (top movers + formation value + perf chart; `<TopMovers>` owns the `%` / `$` ranking switch and its `dp.prefs` persistence), `<MarketConditions>` (10 cards desktop, 9 cards mobile in a 3 × 3 grid; SOX dropped on mobile), `<UpcomingEarnings>` (next 3 future earnings dates, sorted ascending, with BMO/AMC time hints and the fiscal quarter beside the ticker (`RKLB FY26Q2`). A report stays listed for the whole of its London day rather than disappearing at its scheduled time — a 21:00 print used to vanish at 21:00, which is exactly when the numbers land. The day key is recomputed per render and fed into the memo's deps so a PWA left open across midnight rolls the list over on the next tick. **Board-scoped**, i.e. tickers referenced by a position, the same scope `computeMetrics` counts by. Keying it off `Object.keys(holdings)` kept listing earnings for fully-sold stocks, whose holding row is deliberately retained for its buy/sell ledger). The clock + STALE pill live in their own leaf components (`HeaderTime`, `HeaderStatusPill`) so the parent Header doesn't re-render every second. The sidebar foot shows the `R · E · X` keyboard-shortcut hint on desktop (the keys don't fire on touch so the row is hidden on mobile) and a multi-source label (`Yahoo · Eastmoney · Finnhub · AV · T212`) reflecting every external provider the dashboard integrates. The foot also carries two always-visible diagnostics: **Quotes** (`got/wanted` — holdings that actually received a price on the last tick, from `refreshPrices`' coverage) and **Build** (`APP_VERSION`). Both exist because "every ticker reads 0.00 %" is unattributable from the outside — it looks identical whether the market is flat, the ext quote is missing, or the fetch came back nearly empty — and because an installed PWA can sit on a stale service worker long after a fix ships, so "am I even running the new build?" needs an answer that doesn't require devtools. Re-exports `<PerfPanel>` from `perf_chart.jsx` so `app.jsx` keeps its existing import. |
| `perf_chart.jsx` | `<PerfChart>` (the chart) + `<PerfPanel>` (chrome wrapper). 5 ranges, dual fetch effect (S&P alone + portfolio batch in parallel), background prefetch effect for the other ranges, DOM-ref crosshair, CLOSE/OPEN markers in 1D, ^GSPC RTH filter + ES=F ETH filter. **Night-market (overnight) inclusion on 1D + 1W**: when the Extended Hours toggle is on, the S&P reference switches to the ES=F future on BOTH 1D and 1W (`spSymbolFor` — the cash index ^GSPC is RTH-only and can't carry pre/post or overnight), 1W pulls pre/post bars via the `1w-ext` variant (`perfFetchParams`; passes through `applyVariantFilter` untrimmed), and whenever the toggle is on the ES=F `[4 AM,8 PM) ET` session filter is lifted so the futures line runs continuously through 20:00–04:00 ET. The portfolio line is sampled at the S&P series' timestamps, so to draw a real overnight curve (not a flat carry-forward) each ticker's Yahoo bars are spliced with the server-recorded overnight points (`mergeOvernightSeries` over `overnight-fetch`'s T212 samples, same source the ticker modal draws; `NIGHT_BAR_INTERVAL_MS` matches recorded-point density to the 5/30-min bar cadence). Gated on the toggle, NOT the live overnight phase — so last night's overnight stays drawn through the next trading day; the 1D anchor stays phase-aware (prevClose during RTH), the correct baseline for the whole 24 h window since the overnight happened after that close. `spSymbolFor` / `perfVariantKey` / `perfFetchParams` are exported + pinned by `perf_chart.test.jsx`. | The per-bar build — merge overnight points, fold in recorded bars, `buildTickerSeries`, then one `computeAt` per point (one valuation of the whole book per bar) — is cached behind `seriesCacheRef` rather than a `useMemo`: it cannot run until after the loading / error guards, and a hook after an early return is how this component shipped React error #310 once. The key uses prop/state IDENTITY plus a SIGNATURE for `spWindow` (length, both ends, the right-edge close) because `spWindow` is rebuilt by `.filter()` every render and keying on it made the cache miss every time; `todayMs` is excluded on purpose, being `Date.now()`. Measured: five renders with identical inputs ran 15 valuations before, 3 after.
| `pitch.jsx` | Football-pitch SVG rendering. Position chips, captain armband, hot-mover ball, inline subtitle rename in edit mode. **Edit-mode drag-to-swap**: dragging one position chip onto another calls `onSwapPositions(keyA, keyB)` (app.jsx `swapPositions` — swaps `subtitle` + `tickers`, keeps `label`/`role`/slot). Implemented with **Pointer Events** (mouse + touch; HTML5 DnD never fires on touch) handled imperatively — direct `style.transform` + `classList` on the dragged / drop-target nodes so each pointermove doesn't re-render every chip; only the final swap goes through React. The dragged chip is `pointer-events:none` during the gesture so `document.elementFromPoint` resolves the chip underneath as the drop target; an 8px movement threshold separates a drag from a tap, and a `clickGuardRef` swallows the post-pointerup click so a swap doesn't also open the drill modal. |
| `movers.js` / `movers.test.js` | What a "mover" IS, pure and away from the panel: `MOVER_WINDOWS`, `rangeKeyForWindow`, `dayMoveOf` (TODAY — `metrics.js`'s own `dayPct` / `dayChange`, passed through rather than recomputed), `holdingMoveOver` (every longer window — delegates to `computeAt` for ONE holding, so the move covers the time the position was actually held), `rankMovers` (eligibility, order, sides and the ONE bar scale shared across both columns) and `barWidthPct`. Eligibility is identical on every window and in both measures — never cash, never a CN fund, and only names `pctIsFlat` agrees actually moved, which is the same predicate that paints a neutral heat-map tile, so a tile and a row can't contradict each other. 16 closed-form pins. |
| `heatmap.jsx` | One tile per holding, sized by market value, colored by day-change. Tile labels go through `displayTicker` (now in `formatters.js`, re-exported here) — strips the Yahoo exchange suffix (`XFAB.PA` → `XFAB`) and maps the display aliases (every `2DG` variant — `.F` / `.SG` / `.DE` — → `SIVE`, Sivers Semiconductors' home-market symbol). Shared with the tactics-board chips and Top Movers rows so all three read the same; the **chart modal is deliberately the one place that still shows the true Yahoo symbol**, so a tap resolves the right instrument and the user can see which listing they hold. Display-only — the real ticker stays on the data, keys and click handlers. Under the extended-hours toggle a tile with **no** extended figure yet (a US name in the overnight window before a broker quote lands) shows an em dash rather than `+0.00%` — `computeMetrics` flags it `dayPctUnknown`, because painting "nobody knows" as "unchanged" states a fact that isn't one, and a board of flat zeros reads as a broken toggle. |
| `modals.jsx` | `<PositionDrillModal>`, `<EditTickerModal>` (buy-lot editor + a **sell editor** — a "+ Sell" button beside "+ Add lot" records `{ date, shares, price }` sales; the summary shows NET SHARES = buys − sells, the net-cash AVG COST, and this ticker's REALIZED G/L; save passes `{ lots, sells }` to `updateHolding`, which recomputes the net position via `transactions.netPosition` and, on net 0, closes the holding off the board while keeping its ledger — plus **Move holding**, a two-step position picker next to Delete that relocates the ticker to another tactics-board slot via `onMove(toPosKey)`; targets exclude GK and the current slot, and the picker `scrollIntoView`s itself on reveal so a long lot/sell history can't leave it stranded below the fold of the scrollable `.modal-body` while its trigger sits in the fixed `.modal-foot` — without it, "Move holding" read as a no-op on holdings with enough lots to overflow), `<AddTickerModal>`, `<CashModal>`. Also exports `useConfirm()` → `{ confirm, element }`: a themed in-app replacement for `window.confirm` (the bare system dialog sat outside the dark theme and read like an OS error in the iOS PWA). `await confirm({ title, message, detail, confirmLabel, danger })` resolves true/false; the dialog portals to `<body>` so it stacks above the modal that raised it. Used for every destructive confirm — reset board, remove holding, discard-unsaved-changes on close / Move. Move-flow + the themed discard confirm pinned by `modals.test.jsx`. `<EditTickerModal>` shows a holding's buys and sells as **one date-ordered list, newest at the top** (`toLedgerRows` / `fromLedgerRows`), each row leading with a clickable BUY/SELL badge that flips its direction, then the date. Two separate grids read fine on four hand-typed rows and not at all on a hundred synced fills, where what you want is simply what happened most recently. The list is sorted once at mount — re-sorting per keystroke would make a row jump out from under the cursor the moment its date changed — and a new row is inserted at the top. The rows ARE the broker's trades for a synced holding: the refresh tick rebuilds them from `t212_orders` (`t212_fills.js`), which is the answer to "why does this ticker's history stop months ago". One dim line under the list says where they came from (`ledgerProvenance` → synced / still loading / yours). `+ Add buy` / `+ Add sell` stamp `src: 'other'` so a trade made where the broker can't see it survives the next rebuild. Separately, the modal warns when the rows account for FEWER shares than the board holds, because Save recomputes `shares` from the ledger (`updateHolding` → `netPosition`) and 16 of 26 holdings carry lots short of their board count — Save on RKLB would otherwise have silently dropped it from 160 shares to 30. |
| `ticker_chart_modal.jsx` | Single-ticker price-history modal. **3M sampling**: any instrument whose tape runs overnight (`tradingWeekOf` — crypto, futures, spot FX) is resampled onto the portfolio panel's four-hour London grid, over the days it trades: every day for crypto, weekdays for the rest. So a Market Conditions card opened in extended-hours mode draws the same six-a-day points the performance chart does instead of ~23 hourly bars, and no 3M chart anywhere records every hour around the clock. A `session` instrument keeps Yahoo's hourly bars — those only ever span its own session, never 24 hours. The MA overlay's wider history is resampled onto the same grid and `maBarsFor` takes `SLOTS_PER_DAY`, because `computeMaSeries` unions history and display by date and 60-minute history bars beside six-a-day display bars would make "MA 20" cover a span that drifts across the chart. PerfPanel's range buttons plus a modal-only **1Y** (trailing-12-month) price range after YTD, plus one optional valuation button — `P/E 1Y` for profitable stocks, `P/S 1Y` for loss-makers, mutually exclusive. Header shows the company full name (the holdings list's `COMPANY_NAMES` map) on its own row above Mkt Cap for tickers in the map; the row below carries `Last $price · DAY %change` on price ranges, switches to `P/E ratio · 3Y AVG` or `P/S ratio · 3Y AVG` on the valuation buttons, and includes a live `Mkt Cap $value` (recomputed every poll from `price × sharesOutstanding`, where `sharesOutstanding` comes server-side from `marketCap / price` rather than `defaultKeyStatistics.sharesOutstanding` so ADRs stay correct — Yahoo's "shares outstanding" field for ADRs reports the foreign parent-company share count, which would balloon T's market cap by orders of magnitude). A separate PEG line sits below the P/E row when applicable. Holdings get a `Shares · AC · Cost · Value(%) · G/L` line. Overlays: gray `MA 5 / 10 / 20 / 50 / 200` on 1W / 1M / 3M / YTD / 1Y respectively (the 1Y view draws a **200-day** MA, fed by a 2y wider fetch so the window is full to the left edge; bar-based SMA on a same-interval wider fetch held in `dp.maCache`, with the display series merged in so the line spans the full chart even when the cache drifts); gray `VWAP` on 1D for tickers Yahoo gives per-bar volume for (US equity reset 09:30 ET / pre-market 04:00 ET when ext is on; crypto reset 00:00 UTC; forward-fill smoothing for sparse-volume tickers like BTC-USD). DOM-ref crosshair (no React rerender on hover), persistent IndexedDB cache + stale-while-revalidate, 6-digit CN funds and `.PVT` private holdings restricted to 1M / 3M / YTD / 1Y. **Crypto 1D window**: BTC-USD trades 24/7, but its 1D chart follows the US session like a stock. Three cases: ext ON → the full trailing 24 h (`filterToLast24h`); ext OFF while the US market is **open** → "from the last 16:00-ET close to now" (`windowSinceLastUsClose`); ext OFF while the US market is **closed** (pre / after / overnight) → the last complete close-to-close day (`windowBetweenLastTwoUsCloses`) — from the previous US close through the most recent one, **ending at that close**, so like a US stock's 1D after hours the chart stops at the close and hides the current overnight move rather than trailing to now. The data hook keeps ~60 h for crypto 1D (enough for the previous close, up to ~42 h back in pre-market, to be present) so the modal slices on toggle/phase without a refetch (pairs with the prices Edge Function anchoring crypto's day change at the US close). **Sparse-tape venue listings** (`venueSessionFor` — `2DG.F`): the 1D renders on the fixed venue-session grid via `fillVenueSessionGrid`, so the chart always spans 07:00–21:00 UK with flat carry-forward segments where the illiquid tape has no prints, instead of dying at the day's last trade. **Overnight live dot**: for a US equity with an overnight session held in T212 (`hasOvernightSession` — OTC ADRs like SFTBY are excluded so they don't show a stale close as a fake heartbeat), during the overnight session (20:00–04:00 ET) with the Extended Hours toggle on, the broker's `currentPrice` (carried on `holding.extPrice`) renders as a single UNCONNECTED pulsing heartbeat dot at the far-right of the 1D / 1W / 1M chart — Yahoo has no overnight bars, so the historical line stays real and the x-axis reserves a gap proportional to elapsed overnight time (`chart_geometry.overnightTrailingGap`) so the dot floats at its true-time position. The dot is held back entirely when the newest real bar is more than ~10 h old (`chart_geometry.overnightDotWithinReach`): at the Sun-20:00-ET overnight reopen the recorder still has 0–1 points, so the dot — not yet the line — would render, and the time-proportional gap from Friday's ~48 h-old close would fling it far off the right past a blank span (the "weekend big gap"); the chart waits the few minutes until the recorder's ≥2 points draw the gap-free index-based line instead. The dot (and the spliced line) are also suppressed all day on a full-day US holiday (`isUsMarketHoliday`) and across the weekend dead zone — the market is shut, so the frozen T212 close isn't a live overnight quote and shouldn't draw. While the dot is shown the static end-of-line dot is suppressed (avoids a double marker); the crosshair can snap onto the dot (`geom.hasLiveDot` makes `pointerToDataIndex` return the live point in the dot-half of the gap) and reads its price + current time; a rightmost x-axis tick labels the dot with the live time; and the VWAP / MA overlay labels move from the far-right margin to the line's end so they don't float across the gap. Gated so regular / pre-market / after-hours and non-US tickers are byte-for-byte unchanged. P/E view divides the trailing-1Y daily price series by historical TTM EPS from Yahoo's `fundamentals-timeseries` so the curve steps on earnings dates; P/S view divides by a TTM sales-per-share history rolled from Yahoo's `quarterlyTotalRevenue` (4-quarter sum via `rollingTtmFromRawQuarterly`, rescaled to USD via `normalizeEpsHistoryToUsd`), falling back to const current sales-per-share when no quarterly history is published. Both ratio views derive their per-share denominator from `lastClose / ratio` so the chart stays USD-correct for ADRs regardless of whether the upstream returned EPS / revenue in the foreign reporting currency. Both the bar fetch and the fundamentals fetch retry 3× with 250 ms / 500 ms backoff before reporting `fetch.histsingle` / `fetch.pe.network-drop` to ops-error, so a single transient Yahoo burp doesn't flip the modal into the red "Couldn't load history" state. When no usable ratio exists in either flavour (very-recent IPOs etc.) the modal renders the soft "P/E not available — N/A" panel instead of an error. Indicator math (MA, VWAP, PE-from-TTM-history, extended-hours-bar detection, `extPriceIsRealAh` ext-trade verdict) lives in `indicators.js` so it can be pinned by tests; ticker shape predicates come from `ticker_class.js`; cache helpers from `cache.js`; the pure constant maps + `fmtTickerPrice` / `modalTtl` / `modalCache` get/set live in `ticker_chart_helpers.js`; and the data layer — all six fetch effects + their state — lives in two `renderHook`-tested hooks, `use_ticker_fundamentals.js` (valuation metadata) + `use_ticker_chart_data.js` (price series), so the component itself is now geometry + render. | The modal's 1D poll (`use_ticker_chart_data.js`, 5 s, self-rearming) is gated twice: it stops while `document.hidden` and resumes on `visibilitychange`, and it stops in the overnight window for anything that cannot print then — crypto runs 24/7 and `hasOvernightSession` names the US tickers that trade the T212 overnight, everything else is idle. A modal forgotten in a background tab used to poll every five seconds all weekend.
| `ticker_chart_helpers.js` / `ticker_chart_helpers.test.js` | Pure module-scope helpers carved out of the modal: `SYMBOL_BY_CUR`, `NIGHT_BAR_INTERVAL_MS`, `TICKER_DISPLAY_NAMES`, `INDEX_PE_ALLOWED`, `fmtTickerPrice` (per-ticker price formatter — `%` for `^TNX`, 4dp for FX, no prefix for indices/futures, currency-prefixed for equities), `modalTtl`, and the `modalCacheGet`/`modalCacheSet` ChartStore wrappers. Pinned independently of React. |
| `use_ticker_fundamentals.js` / `.test.jsx` | `useTickerFundamentals(ticker, supportsPePattern)` — the modal's valuation-metadata data layer: the synchronous `\|FUND\|v3` cache seed + the background fundamentals fetch + write-back, returning `{ peSupported, psSupported, pe3yAvg, ps3yAvg, peg, sharesOut }` (which feed the modal's `visibleRangeKeys` + header). `renderHook`-tested. |
| `use_ticker_chart_data.js` / `.test.jsx` | `useTickerChartData({...})` — the modal's price-series data layer: the five fetch effects (main range fetch incl. the PE/PS TTM transform, MA-overlay history, background other-range prefetch, 1D live-poll, overnight recorded-points) + their state, returning `{ series, loading, error, noPe, maHistory, overnightPts }`. This is the block that fixed bug after bug (overnight race, ext anchor, prefetch coverage, PE/PS window); pulling it out of the 1400-line component into a `renderHook`-tested hook is what keeps it from being a moving target. The modal consumes the two hooks and keeps the geometry + render. |
| `chunk_recovery.js` / `chunk_recovery.test.js` | What happens when a lazily loaded page's code does not arrive — a deployment event, not a crash. `isChunkLoadError` knows every browser's words for it (and the `nosniff` MIME refusal production produced), `chunkUrlFromError` pulls the chunk URL out of the message, `shouldHeal` allows one heal per five-minute window, `healAndReload` refreshes the browser's copy of the chunk (`fetch` with `cache: 'reload'`), unregisters every service worker, deletes every cache, reports `chunk.load` and reloads — each step best-effort and independent — and `lazyPage` is the `React.lazy` the five page chunks use: a load failure heals instead of throwing, the Suspense frame stays up while the page goes away, and a second failure inside the window is thrown to the page's own boundary. Pinned with fakes for each step, the order they run in, the once-per-window guard and the no-worker / no-URL browser. |
| `sw-banner.jsx` | "New version available — RELOAD" banner. Uses `useRegisterSW` from `vite-plugin-pwa`. Polls for new versions every 60 s (was 10 min) AND on `visibilitychange` / `focus` so a backgrounded PWA picks up the banner the moment the user opens it. Kicks `updateServiceWorker(true)` for the standard `controllerchange`-driven reload, with a hard `window.location.reload()` fallback because iOS Safari (and standalone-PWA Chrome) don't fire `controllerchange` reliably. The fallback timer is armed UP FRONT (not after the cleanup `await`s): the reload used to sit at the end of the purge chain, so a single wedged step (e.g. a blocked `indexedDB` op whose callback never fires) stranded it and the button stuck on "RELOADING…" forever. Now a hard timer owns the reload and the purge (`purgeForReload`, extracted + pinned) merely races it: reload fires at whichever lands first, a finished purge or the 1.5 s deadline. The purge clears the Workbox caches + every registered SW (so the new bundle's assets load) and `localStorage`, but **deliberately keeps the IndexedDB chart cache** (`chart_store` — version-suffixed, TTL'd price bars): wiping it gained nothing but made every chart open after a version reload a cold 1-2 s fetch, throwing away the prefetch + boot-hydrate that warm it. The auth token survives in sessionStorage (persists across reload-in-tab). |
| `ops_error.js` / `ops_error_badge.jsx` | `reportError(kind, opts)` POSTs failures to the `ops-error` Edge Function (per-`(kind, symbol)` cooldown + per-load cap, `keepalive: true` so render-crash reports survive a Reload). `fetchOpsErrorSummary(hours)` reads the same function's `?action=summary` endpoint with the admin `x-app-token` header attached so admin viewers can pull the last-24 h aggregate without hitting Supabase directly. **What we report**: `auth.unexpected` / `auth.network` (auth failures), `render.crash` (React error boundary), `fetch.histsingle` (chart fetch ran out of retries), `fetch.perfchart.anchor` (PerfChart anchor missing), `fetch.pe.network-drop` (fundamentals Edge Function returned no row at all for a ticker — real backend incident). **What we deliberately don't report**: `fx-fallback` (FX MISSING pill already shows it interactively); the "ticker has no positive trailing P/E" case (loss-makers like NBIS — legitimate financial state, not a bug); `data.save.conflict` (a 412 optimistic-concurrency reply is the normal self-healing multi-tab/device outcome — the conflict banner + next auto-refresh fetch the latest, not a backend incident); and `sw.activation.timeout` (dropped — iOS Safari / standalone-PWA Chrome fire `controllerchange` unreliably even on a healthy RELOAD, so the report was pure noise for a path that self-heals via the hard reload that runs regardless). The `OpsErrorBadge` component (desktop-gated, see Highlights) is the in-app surface for the summary; the same endpoint is still queryable directly when finer triage is needed. |
| `prefetch.js` | `prefetchAllChartData(opts)`. Fired from `doRefresh` on initial load + manual Refresh click (skipped on the 30 s auto-refresh tick). Walks every (range × ticker) combo, skips ranges that are fully fresh under their TTL (and treats 1D rows missing the new `volume` field as stale so the VWAP overlay shows up after the Edge Function redeploy without a manual cache wipe), and writes results into the PerfChart cache (`dp.ytd`), the TickerChartModal cache (`dp.tickerChart`), and the MA overlay's wider-history cache (`dp.maCache`) so the next chart open is instant. The range walk includes the modal-only **1Y** range, so `${ticker}\|1Y` is warm on first modal open and — critically — the **same** trailing-1Y price series feeds the P/E / P/S precompute below, so the app-prefetched ratio series can't disagree with the modal's own fetch. Also fetches each eligible ticker's full fundamentals row (`{eps, pe, pe3yAvg, ttmEpsHistory}`) — cached under `${ticker}\|FUND\|v3` so the modal's P/E-button visibility can be decided synchronously on first paint, and the `${ticker}\|PE\|v5\|...` series is precomputed via `priceDividedByTtmEps` (over the 1Y series) so clicking P/E 1Y hits cache instantly instead of waiting on a fresh fundamentals fetch. **The PE/PS algorithm-version suffixes step on breaking changes** (P/E `v4→v5`, P/S `v2→v3` were the YTD→trailing-1Y price-window switch; earlier bumps evicted the broken-anchor ADR peSeries rows) — `PE_TTL_MS = 12 h` plus the prefetch's `fundFresh && ratioFresh` skip gate means any browser holding a stale-shape series would otherwise stay stuck on it until the TTL elapsed, so bumping the suffix is the standard cache-busting move. Uses the shared `cache.js` (`isFresh` / `hasAnyNumericField` / `trimLru`) and `ticker_class.js` (`isDailyOnly` / `isCrypto`) helpers so the prefetch + modal can't disagree on freshness or daily-only routing. Crypto 1D writes into the modal cache keep the trailing ~60 h of raw bars (`filterToLastHours`) instead of the generic variant trim — same rule as `use_ticker_chart_data`'s `applyChartWindow` — so a prefetched BTC 1D cache still has the previous US close the modal's ext-OFF close-to-close slice needs. |
| `trading212.js` / `trading212.test.js` | `fetchTrading212Holdings()` hits the `trading212` Edge Function and returns `{ holdings: { 'VUAA.L': { shares, cost }, … }, prices: { 'VUAA.L': 98.4, 'AAPL': 234.5, … } }` or null; `applyTrading212(holdings, t212, prices, today)` overlays the shares/cost allow-list on the live portfolio by replacing each matching ticker's `lots` with a single synthetic lot dated today — AND, when a `prices` map is supplied, uses the broker's live `currentPrice` (USD) as the regular-session `lastPrice` **for `VUAA.L` / `SAEM.L` only** (`T212_LIVE_PRICE_TICKERS`) — widening the sync to every reported position once widened this with it, and that quietly zeroed the extended-hours board: `applyTrading212NightPrice` measures the overnight move against `lastPrice` as today's regular close, so with the broker's own quote sitting in `lastPrice` it compared that quote against itself and every US holding read exactly 0.00 %, recomputing `dayPct` against the (Yahoo) prevClose and pinning currency USD. This is because Yahoo's free LSE feed lags ~15-20 min at the 08:00 UK open (VUAA.L / SAEM.L would otherwise sit on a stale close after a Refresh), so the broker's own quote is both fresher and already in USD; the price updates in lockstep with the shares on every auto-refresh + manual Refresh. `applyTrading212NightPrice(holdings, prices, active)` overlays the same `prices` map as OVERNIGHT quotes for US equities instead (only tickers with `hasOvernightSession` — US equities excluding OTC ADRs like SFTBY — and only when `active`). Both fired in parallel with the live-prices / MC / ext-series fetches inside `doRefresh`, applied AFTER the Yahoo merge so they see the just-set prevClose. Best-effort: a null T212 response (or a ticker missing from `prices`) leaves the lots + Yahoo price alone, so a transient upstream error doesn't wipe what the user last saved manually. The user can still edit lots in EditTickerModal; the next auto-refresh tick just overwrites the manual edit with whatever T212 reports. **`applyTrading212` never replaces the user's lots or sells** — a board row can hold the same ticker at T212 and at another broker, and overwriting its ledger with machine history was a production data-loss bug. It keeps the existing lots, tags the broker's slice as `t212Shares` / `t212Cost` so a later refresh applies only that slice's delta, and writes a stand-in lot only when there is nothing there at all — **without re-dating it to today on every sync**, which once made the whole book look bought this morning. On a ticker's FIRST sync a board position LARGER than the broker's keeps the excess — those are shares held at another platform, and taking the broker as the whole position deleted 71 SPCX / 11.5 RKLB / 30 HOOD shares from the live book. Nothing is lost by being conservative: a holding the board records as sold out still comes back whole, because `max(0, 0 − held)` is 0 and the broker's slice is all of it — which is how PLTR's 55 shares return. The sync also covers **every** position the broker reports, not just the two DCA'd ETFs — that allow-list existed to guard against the overwrite this no longer performs, so all it did was hide real positions. `syncTrading212History` walks `/equity/history/orders` a page at a time into `t212_orders` for real purchase DATES (`/equity/positions` has none), and `shapeT212Order` takes a skip-reason sink so a page that stores nothing reports which field it was missing rather than only how many rows it dropped. `lotsFromOrders(orders, ticker)` turns those fills back into `{ lots, sells }` for `t212_fills.js`, carrying each fill's **moment** in `ts` as well as its day in `date` — `date` stays `YYYY-MM-DD` because every date comparison in the chart maths depends on it, while `ts` is what orders same-day rows: ORCL was bought nineteen times in one day and without it they arrive in whatever order the two accounts merged in. |
| `types.d.ts` | JSDoc-friendly type definitions. |
| `styles.css` | All app styles (single sheet). |
| `test_setup.js` | Single-line vitest setup file (referenced from `vite.config.js → test.setupFiles`). Imports `@testing-library/jest-dom/vitest` so `toBeInTheDocument` / `toHaveTextContent` etc. work in every test without a per-file import. |
| `ticker_chart_modal.test.jsx` / `perf_chart.test.jsx` / `app.test.jsx` | Component-level smoke tests (React-Testing-Library on top of vitest's `jsdom` env). Each one mounts the component with heavy children + network calls mocked via `vi.mock` and asserts the render-decision tree (loading / error / has-data branches) hasn't drifted. Bar is "regression coverage for prop renames + hook reorders", not E2E — the math is still pinned by the pure-helper tests. |
| `index.html` | Vite root. References `/assets/index-<hash>.js`. |

### `supabase/functions/` — Edge Functions (Deno)

| Function | What it does |
|---|---|
| `agents` | The crypto agents' server half. `POST ?action=tick` (pg_cron **every minute**, migration `0037`; cron bearer or admin token) runs one turn of `tick.ts`, in order: (1) both venues' public quotes for every symbol in play, the basis between them recorded every fifth minute (`agent_basis`), the candle series each rulebook reads from its `signal_venue` (cached in `agent_candles` and topped up with the venue's tail, so a turn costs a few small calls) and the execution venue's last closed 1-minute candle for paper fills; (2) open orders — a `pending` row (written before a live order was sent) is reconciled against the venue's active orders by client id — one the venue does not list STAYS pending and is reported every turn with the venue's balance beside the record, for a person to settle, never marked rejected on a guess — a paper order fills when the venue's last minute traded through its price (a marketable one at once) and pays that venue's maker (taker) fee, a live order is re-read from the venue (a filled Revolut X order whose reply lacks the settlement fields is refused, never settled at fee 0), a cancel whose read-back fails leaves the row open, and a resting order whose touch has moved ≥ 5 bps away after three minutes is cancelled and re-quoted at the new touch through the same risk gate as any order, five times at most, nothing resting past an hour; (3) the book per venue and mode, derived from fills read page by page (PostgREST stops at 1,000 rows without a word), plus every open buy's unfilled notional as exposure — and a position carries the MODE it was opened in (`posKey`, `bookKey`; 2026-09-22), because keyed on strategy and symbol alone a row flipped from paper to live inherited its paper positions, so the rulebook read itself already long, never bought the coin for real, and the first exit or floor stop would have placed a REAL sell for base the account never bought; a PAUSED row is the exception and still sees the book it was trading, or `0043`'s stuck positions come back; (4) **protective stops every minute** against the live mark — a hard floor under cost, on every rule, sold without asking the model, marketable on Revolut X; there is NO intra-bar ATR trail since 2026-09-21, because it was the rulebook's own 3×ATR-from-high-water trail evaluated on wicks rather than closes and pre-empted it on 48 of 49 protective exits in one walk-forward window (reference §3.13, §4.11) — the rulebook's trail is untouched and now does that work on closes; (4a) **the thin-book guard**: a long position's stop is judged at the BID (`exitMark`), never the mid — the stop was always checked on the mid and filled at the bid, half a spread of wishful thinking — and an ENTRY is refused when the book is wider than 50 bps (`WIDE_SPREAD_BPS`, `bookBps` recorded on the decision), because every Revolut X entry crosses and pays the ask; an exit is never refused by it, because a stop exists for exactly the minute the book is ugly; (4b) **a retired row that still HOLDS something keeps its exits** — the tick reads retired rows, derives the book, and runs the floor and the rulebook's own exit for any that are still long (`windingDown` in the report), refusing every entry; one that is flat is skipped before any decision work. `0043` retired three rows that were still long and their positions had no exit path at all: the tick skipped a paused row and `riskGate` refused a paused row's EXIT, from a test that sat above the branch whose own comment says an exit is never refused. The global pause still outranks an exit; a paused strategy no longer does; (5) **observations every minute** — the categorical state on the FORMING bar, written to `agent_observations` when it changes, which is what the page shows as the live state; (6) **decisions on a newly closed bar** of the rule's own size and with no order in flight: build the state (`_shared/agents_strategy.ts`; the rotation rule ranks the whole cross-section first), ask Jev on entries only (`_shared/jev.ts`: OpenRouter first, TypeSafe direct as fallback, `provider: none` when both fail — which means hold; it can veto an entry and never advises an exit), apply the rulebook (after any exit a rule waits two of its own bars before buying again), apply the risk gate (per-order cap, exposure per venue and mode — paper twins have their own `paper_exposure_usd` — and an order count that, like the daily loss limit, blocks new risk and never an exit; global pause; every number from `agent_risk`), CLAIM the bar by inserting the decision (a unique index on strategy, symbol and bar makes a second claim fail, so overlapping ticks cannot both order; a protective decision claims one second INTO the minute, so a stop that lapses is retried next minute and a bar start is never taken; an allowed decision whose order never reached the book is placed on a later turn, the order insert being the claim on that attempt — migration `0041`), and place the order it allows: **marketable at the touch on Revolut X** (9 bps, the backtests' fill), post-only at the touch on Kraken (stops rest at the ask). **A marketable order also opens a maker probe** (`agent_maker_probes`, migration `0042`): the same order's other-side touch is written down, and turns 2b resolve it against the execution venue's last closed minute and record the mark 15 and 60 minutes later — the adverse-selection measurement §3.13 needed and a backtest cannot give. A probe is never an order and never reaches any book. One turn at a time: the tick takes a 55-second lease in `agent_locks` (compare-and-set), renews it once past half, releases only its own, and past 70 % of it opens no new bar decision (stops and observations are never deferred); a turn that finds the lease held does nothing. A partially filled live order is a position from its first fill; a live order that filled on arrival is settled next turn from the venue's own view, fee included; a venue-cancelled order that had filled in part is a fill of that part; one pair's failure never costs the other pairs their turn. The `dislocation-1m` rulebook (decided from the two venues' live quotes every minute; reference §3.5) stays in the code but its seed was retired by migration `0038` (`retired_at`), so nothing runs it or shows it. A live order additionally needs `agent_strategies.mode = 'live'`, `agent_risk.live_confirmed_at` set, and credentials for that venue. `GET ?action=dashboard` (admin or ro) computes what the page shows — the latest observation per strategy × symbol comes from one tiny indexed query EACH (`latestObservationQuery`), never one window over all of them, because an observation is written only when the state changes and a pair whose words have been steady for hours is otherwise pushed out of any fixed limit by the busy pairs, leaving the page to claim there is no reading yet about a symbol the loop reads every minute (AVAX, 2026-09-21) — — positions and P&L from fills via `positionFromFills`, marked at each venue's mid, **today's change per strategy and per venue** (`dayPnl`, the tick's own daily-loss arithmetic: realised since 00:00 UTC plus the move from the day's open, which comes from the cached daily candles; `dayStart` in the payload), the latest observation per symbol, the book split by venue, the 24 h basis per symbol, each strategy's next decision time, the **maker-probe summary** (in the payload, not on the page — it was rendered under VENUES for an hour on 2026-09-22 and taken off on Davies' word; the probe keeps collecting and the numbers are read with a query) (`probeSummary`: fill rate over resolved probes, median minutes to fill, and `adverseBps` at +15 / +60 minutes signed so POSITIVE is against the fill — read against §3.13's 10–20 bps break-even to answer whether 0 % maker is actually free here), plus venue health, caps, Jev spend and recent decisions / orders; a RETIRED strategy row is on the page only while it still holds something, and is filtered out before the totals are summed so the aggregates keep the meaning they had; before migration 0037 has run it (and `chart` and `log`) answers `{ notReady: true }` instead of a 500; Kraken's fee tier is read once an hour per isolate, not on every page load. `GET ?action=chart&strategy=&symbol=` returns one strategy × symbol for the detail page: the signal venue's cached candles over the rule's window (12 h of minutes, 7 d of hours or 30 d of 4-hour bars), every order and fill in it, its decisions and the latest observation. `GET ?action=log&strategy=` pages more. `GET ?action=probe` (cron or admin) is the read-only credential self-check: signed Revolut X balances / pairs (every symbol on an active row) / candles-with-query / active orders (the field names the settlement path reads) plus the region's filtered tickers with their spreads (one row per symbol, or the filter is not being honoured), Kraken balances / fee tier / open orders / closed orders (the settled shape, and whether the client id comes back) / `AddOrder validate=true` (the venue checks and places nothing), Jev on both transports. Venues behind one interface (`_shared/venue.ts`): `_shared/revx.ts` (Ed25519-signed; keyless public market data, always for the account's region — `REVX_REGION`, UK — because the venue publishes two books per pair, the region-less tickers return both rows in arbitrary order and the region-less candles are the EEA book's; `quotesForRegion` drops a row from any other region) and `_shared/kraken.ts` (HMAC-SHA512-signed, test vector pinned; OHLC capped at 720 candles). **Auth: cron bearer or `x-app-token`**, so it deploys `--no-verify-jwt` (in `PUBLIC_FNS`). Pinned by `strategy.test.ts`, `momentum.test.ts`, `jev.test.ts`, `revx.test.ts`, `kraken.test.ts`, `tick.test.ts`, `index.test.ts`. `backtest.ts` is the walk-forward backtester run by hand (same functions as the loop, the loop's own fills — Revolut X takes the touch, Kraken rests — its stops read against each bar's low, and its two-bar re-entry cooldown; `runRotation` takes the same stops, which it did not until 2026-09-21 — the rotation tables until then described a rule the loop does not run, and with the floor in, five of six rotation variants are WORSE, reference §3.4 — pinned by `backtest.test.ts`) that writes `docs/agents/backtests/latest.json` and `summary.json` (carrying over the two studies it does not produce); it reports a parameter **plateau** per coin (the share of the 27-point grid positive out of sample, the grid's median, the chosen point's rank), and `--symbols` / `--basket` / `--study <name>` widen a run into a named study file such as `universe.json` (reference §3.7) or `universe20.json` (§3.8, the top twenty by market cap; the basket runs beside it) without touching the page's files; every symbol keeps its own untruncated series and the rotation basket gets its own aligned copy, so a young basket member cannot shorten another coin's checks. `backtest_kraken.ts` is the venue study (reference §3.12: seven rulebooks from four hours to weekly bars over 27 coins, the per-trade return distribution against an 82 bps round trip, the fee-tier arithmetic, and the FIRST measurement of Kraken's own 24-hour book and order minimums for all 27 — keyless public endpoints only; output `kraken.json`). `backtest_allocation.ts` is the allocation study (reference §3.11: seven weighting arms per coin, thirteen row plans, the venue break-even arithmetic and the leave-one-out tests; its `runSized` copy is checked against `run` on 40 cells at zero difference; output `allocation.json`). `backtest_portfolio.ts` is the portfolio study (imports `run` / `runRotation` / `COSTS` / the stops; a `runSized` copy checked against `run` to the digit for the regime gate and per-entry sizing; output `portfolio.json`, report in `docs/agents/reviews/`). `backtest_ideas.ts` is a second study script that imports the same `run` / `resample` / `COSTS` / stops and the live rulebooks to test rule ideas against the shipped trend rule (a BTC-regime filter, a bare Donchian breakout, a 4-hour pullback, a stale-trend exit, weekly bars — reference §3.9; output `ideas.json`); its baseline reproduces §3.7's table exactly, which is how the reuse is checked. `backtest_kraken2.ts` is the Kraken standalone study (reference §3.14: six slow rulebooks over 68 coins reached by measuring 622 online Kraken USD pairs keylessly, a verdict with a number for every TESTING row, three paper candidates, and the FIRST comparison of Kraken's own tape against the Coinbase series every other table uses — median 2.5 points apart, maximum 68 on the same twelve trades; its `runLogged` copy is checked against `run` on 252 cells at zero difference; output `kraken2.json`). `backtest_windows.ts` is the third-window study (reference §3.15: a THIRD walk-forward window spliced from Kraken's free quarterly OHLCVT bundle strictly before each coin's Coinbase series, plus a fourth sideways window; the live candidate, the one-window cohort and the two written-down candidates priced on all of them, the whole study run twice — once per stop rule — and never averaged; it SHA-256s `backtest.ts` at both ends of a run so a run straddling an edit throws, reproduces §3.8's published table to 0.0004 under the old stop, and its `runGated` copy is checked against `run` on 190 cells per rule at zero difference; output `windows.json`). `backtest_tape.ts` is the tape study (reference §3.16: the same rules priced on KRAKEN's own tape — the one `signal_venue` makes the loop read — against the Coinbase series every other table uses, 288 comparisons over four windows, two venues' costs and both stop rules; its Coinbase arm is checked against `windows.json` cell for cell, 4,464 cells and zero differ, so the two studies are the same arithmetic and every difference is the tape; output `tape.json`). `backtest_fill.ts` is the fill study (reference §3.18: the first table anywhere here to price the loop's actual split — decide on Kraken's candles, fill on Revolut X's own UK book, which turns out to be public — against the published single-tape arms and two proxies; `runSplit` is checked against `run` on 2,600 cells and 903,928 equity-curve points at zero difference, and its own fidelity check caught a 19-point artefact from trailing high-water on the fill tape instead of the signal tape; output `fill.json`). `backtest_set2.ts` re-asks the four settled choices — which coins, equal slots, the mechanics, the venue — on FOUR windows and THREE tapes (reference §3.19: an arm must beat the incumbent on its worst window in all four evaluations; two exact nulls, and the agreement between evaluations measured to say which to read; three `runSet` paths checked against `run` on 844 cells each at zero difference, plus 3,456 cells against `tape.json` and §3.17's published row table typed back in at zero; output `set2.json`). `backtest_testingset.ts` is the TESTING-set study (reference §3.17: all seven rows re-priced on four windows under both stop rules, 33 sideways-year gate arms, the row correlation matrix, cost sensitivity, and the final set migration `0043` ships; output `testingset.json`). `backtest_execution.ts` is the execution and trade-management study (reference §3.13: maker-vs-taker with a no-fill model, the re-entry cooldown grid, a 216-point stop surface chosen on one window and scored on the other, and tranched entries and exits against all-in / all-out; its `runExec` copy is checked against `run` on 60 cells at zero difference; output `execution.json`). It found the 3×ATR trail implemented TWICE — once on the close in `ruleDecision`, once against the bar's low / the live mark as a protective stop — with the intrabar copy taking 48 of 49 protective exits in one window and 67 of 68 in the other. The intra-bar trail was removed the same day and §3.3a re-run, where the 8 % floor turns out never to have fired on BTC, ETH or SOL out of sample; the study's other half, widening that floor to 10 %, was rejected as a single-coin artefact. |
| `auth` | `POST { password }` → `{ token, role }` on success, `429 { lockoutUntil }` after 3 wrong attempts from the same IP. Lockout window **doubles each repeat** (24 h → 48 h → 96 h ... capped at 30 days, per migration `0011`) so a brute-forcer can't grind 3-tries-per-day forever. Per-IP key uses the LAST entry of `x-forwarded-for` (not the first, which the client can spoof). Wrong-password responses are also held for 500 ms server-side as a secondary throttle. Tokens are `<base64url(payload)>.<base64url(sig)>` where payload is `{ role, exp }`, signed HMAC-SHA256 with `APP_AUTH_SECRET`; signature comparison is constant-time across all functions that verify it. |
| `data` | `?action=load` / `?action=save` / `?action=price-snapshots&since=<ms>&bucket=<sec>` (the recorded 5-minute prices, read through the bucketed `price_snapshot_series` RPC — a raw table read of a YTD window is ~60k rows and a plain ascending LIMIT returns January; both roles may read, since a read-only viewer sees the same charts). Validates the `X-App-Token` header (re-derives HMAC + checks exp + checks role) before reading / writing `board_data`. Service-role key never leaves the function. **Optimistic concurrency** (per migration 0013): load returns `{ data, version }`; save forwards the client's `If-Match` header into the `save_board_data` RPC, which performs an atomic version-check + UPSERT and returns 412 `{ error: 'conflict', currentVersion }` when the version doesn't match. Missing `If-Match` falls through to the legacy unconditional write (backward compat for old bundles + one-off scripts). The 42P01 / 42883 detection on RPC failures logs "re-apply migration 0013" so a fresh project missing the migration is obvious from the function log instead of silently degrading to last-write-wins. |
| `prices` | `?tickers=NVDA,017731,GBPUSD=X,…` → `{ ticker: { lastPrice, extPrice?, prevClose, currency, dayPct, extDayPct? } }`. Routes 6-digit codes to eastmoney (fundgz intraday-estimate JSONP first, raced concurrently with an `api.fund.eastmoney.com/f10/lsjz` latest-two-NAVs fallback, then `danjuanapp.com` — fundgz alone gets geo-blocked from Deno egress IPs for hours at a time, and a fund silently missing from the response is what used to push the client onto its slow proxy fallback; parsers pinned in `index.test.ts` as `parseFundgz` / `navPairToResult`), everything else to Yahoo Finance v8. Non-US tickers (any dotted-suffix symbol — `.L`, `.HK`, `.SS`, …) explicitly skip the ext-hours candle scan since they don't have a US-style pre/post session; `extPrice` stays null. **Bogus-quote OTC ADRs (`SFTBY` / `MRAAY`)** — thin SoftBank / Murata ADRs whose Yahoo `regularMarketPrice` AND `regularMarketPreviousClose` both revert to the session open, so the row reads 0.00 % and the holding is valued at that stale price — instead fetch a 2-day window and rebuild `lastPrice` / `prevClose` from the REAL regular-session candles (`rthSessionCloses`: the last 09:30-16:00 ET in-session close today + the previous session's, the actual 16:00 ET prices); they're skipped by the ext-hours scan too. **Crypto (`-USD`, e.g. BTC-USD)** is re-anchored to the US equity session so it reads exactly like a US stock: a 2-day window + `rthSessionCloses` keyed to America/New_York (`etOffsetSec`, DST-aware — Yahoo's crypto gmtoffset is UTC and its `regularMarketPreviousClose` is a midnight-UTC boundary, neither the US close) give `prevClose` = the previous 16:00-ET close and `lastPrice` = today's 16:00-ET close once the US session is over (the live 24/7 price during RTH), with `extPrice` = the live price while off-session (`cryptoUsSessionQuote`). "Off-session" is `isOutsideRth` OR **not a trading day** (`isUsTradingDay` from the shared `_shared/us_market_calendar.ts` rule-based US-holiday calendar, plus weekends), and `rthSessionCloses` likewise skips non-trading-day candles, so on a full-day holiday (e.g. Jul 3 observed) or a weekend the 24/7 crypto is off-session — `lastPrice` = the last REAL close, `extPrice` = live — instead of reading the holiday's own mid-day clock as "in session" and collapsing the day change to 0.00% (the "BTC shows 0% on July 3" bug). So the ext-hours toggle drives the same after-hours move it does for equities and the heatmap/scoreboard anchor at the last US close, not Yahoo's midnight-UTC crypto boundary; the generic outside-RTH ext scan is skipped for crypto (it reads the UTC gmtoffset). All outbound calls wrapped in `AbortSignal.timeout` so a hung upstream can't pin the function for 60 s. **Requires the `X-App-Token`** (same HMAC check as `data`), verified before any upstream call — the anon key alone ships in the public bundle, so it gated nothing. Same gate on `chart` and `fundamentals`; `healthcheck.yml` therefore expects 401 from all three. |
| `chart` | `?tickers=…&range=1mo&interval=60m&includePrePost=true` → `{ ticker: [{ date, close, volume? }, …] }`. Intraday bars also carry the per-bar `volume` (used by the modal's VWAP overlay). Routes CN funds to a 3-tier eastmoney fallback (pingzhongdata → lsjz JSON → danjuanapp), everything else to Yahoo. `.PVT` placeholders fall back to the bare symbol when Yahoo 404s the literal. |
| `fundamentals` | `?tickers=NVDA,NBIS,^GSPC,…` → `{ NVDA: { pe, eps, pe3yAvg, ps, ps3yAvg, peg?, sharesOutstanding?, ttmEpsHistory?, ttmSalesHistory? }, NBIS: { pe:0, eps:0, ps, ps3yAvg, … }, ^GSPC: { pe, eps:0, pe3yAvg }, … }`. Powers the ticker-modal P/E 1Y AND P/S 1Y views AND the live `Mkt Cap` line in the modal header. **Individual stocks**: Yahoo `quoteSummary` is the primary source (`trailingPE` / `trailingEps` / `priceToSalesTrailing12Months` / `forwardPE` / `earningsTrend` / `marketCap` / `price`, all USD-correct for ADRs), with Finnhub `/stock/metric` as the whole-row fallback when Yahoo's crumb handshake fails or it's rate-limited. quoteSummary now 401s anon callers, so `getYahooCrumb()` does the cookie → `/v1/test/getcrumb` → `&crumb=…` handshake once per Edge Function worker and caches the pair in module scope (single-flight guarded so the 6 parallel stock workers don't each handshake). FMP was the primary source through the ADR-currency-fix saga, but it retired its `/v3/` endpoints for post-2025-08-31 keys (403 "Legacy Endpoint") and paywalled the `/stable/` replacements (402), so the whole FMP layer was removed — Finnhub's `peTTM` divides the USD ADR price by the foreign-currency reported EPS (TSM ≈ 1.22 / SFTBY ≈ 0.07 / ASML ≈ 63 — the bug the saga was about), Yahoo's quoteSummary ratios aren't affected. Finnhub still runs in parallel on the happy path to source `pe3yAvg` / `ps3yAvg` from `series.annual.pe` / `series.annual.ps`, since Yahoo doesn't expose historical-annual ratios. The pe/eps/ps validation is relaxed to "any usable ratio surfaces the row" so loss-makers (eps ≤ 0 → no pe) still come back with a ps value for the P/S 1Y view. **PEG** = `computePeg(forwardPE, computeForwardGrowth(earningsTrend.trend))` — forward-over-forward; the growth denominator is the **blended 2y forward EPS growth**, computed by averaging the `0y` and `+1y` bucket `growth.raw` rates from Yahoo's `earningsTrend.trend` and dropping non-positive buckets. Yahoo retired its `+5y` long-term-growth bucket in May 2026, so the two near-term annual buckets are the only free forward CAGRs left; averaging them is steadier than any single fiscal year for cyclical tech / semi names. Returns null when either forward P/E or blended growth is missing or growth ≤ 0. **`sharesOutstanding`** is derived server-side as `marketCap / regularMarketPrice` rather than read from `defaultKeyStatistics.sharesOutstanding` — Yahoo's "shares outstanding" field for ADRs reports the foreign parent-company share count, which would balloon TSM/SFTBY/ASML market caps by orders of magnitude when the client multiplies it by the USD ADR price. The client uses this to recompute the live `Mkt Cap` line every poll (`livePrice × sharesOutstanding`). **Four big US indices** (`^GSPC`/`^NDX`/`^RUT`/`^SOX`) → Alpha Vantage `OVERVIEW` against ETF proxies (SPY/QQQ/IWM/SOXX) cached for 24 h in `index_fundamentals_cache`; 3Y-avg P/E lives in `INDEX_PE_3Y_AVG` constants. Hardcoded `INDEX_PE_FALLBACK` constants kick in if AV is unreachable. Each row also carries **`fiscalQuarter`** (`"FY26Q2"`) for the upcoming report, computed by `fiscalQuarterLabel` from the `earningsTrend` "0q" quarter-end date plus `defaultKeyStatistics.lastFiscalYearEnd` — both already in the same quoteSummary request, so it costs no extra fetch. Yahoo's own `earningsChart.currentQuarterEstimateDate/Year` can't be used: those are CALENDAR quarters, so NVDA's Jul-2026 quarter reads "2Q 2026" against the company's own Q2 **FY2027**, and Apple's Sep-2026 quarter "3Q 2026" against its Q4 FY2026 — they only agree for calendar-year filers like RKLB. Deriving from the fiscal year-end month gets all four cases right (pinned against real probe data in `index.test.ts`). **Opt-in `&ttmEpsHistory=true`** adds a `ttmEpsHistory: [{date, eps}, …]` array sourced from Yahoo's `fundamentals-timeseries` (`trailingDilutedEPS`, 5+ years of pre-summed quarter-end TTM EPS), falling back to a Finnhub `/stock/earnings` sum-of-4-quarters if Yahoo misses. **`&ttmSalesHistory=true`** adds the parallel `ttmSalesHistory: [{date, eps}, …]` array for the P/S 1Y view, but built differently: Yahoo's `trailingTotalRevenue` endpoint only ships 2 stale annual points per ticker (confirmed in the May-2026 prod probe), so the function pulls `quarterlyTotalRevenue` and runs `rollingTtmFromRawQuarterly` to sum every 4 consecutive quarters into a TTM series before rescaling to per-share. For ADRs the upstream EPS / revenue histories are reported in the underlying foreign currency, so the Edge Function rescales each to USD via **`normalizeEpsHistoryToUsd(history, usdAnchor)`** before returning. The `usdAnchor` is Yahoo quoteSummary `price/pe` → Yahoo `/v8/finance/chart` `meta.regularMarketPrice ÷ pe` (the no-crumb endpoint, what Yahoo's consumer site uses); for the sales history the anchor is `usdPrice / ps` so the latest entry lines up with `lastClose / ps`. When the ratio (anchor / latest history entry) lands within ±20 % the function returns the history untouched (it's already in USD), so US-listed stocks pay no rescaling cost. Index rows return `eps:0` and the client reconstructs an implied EPS from `lastClose / pe`. |
| `ops-error` | Two modes, both admin-gated. `POST { kind, symbol?, message?, context? }` with header `x-app-token: <admin token>` → inserts into `ops_errors` (size + length capped; per-row IP captured server-side via the shared `_shared/ip.ts` extraction — `x-real-ip`, then the LAST `x-forwarded-for` entry, same trust order as `auth`'s lockout key). `GET ?action=summary&hours=24` with the same header → `{ hours, total, byKind, bySymbol }` aggregate over the last N hours, so triage doesn't require a Supabase dashboard login. POST was anon-writeable until 2026-05; the client-side per-(kind, symbol) cooldown + 50-per-load cap was trivially bypassable with random kinds, so the admin token gate now mirrors the summary endpoint's existing one. Trade-off: pre-auth render crashes that fire before the user's pwd → token round-trip completes are no longer captured. **Server-side reports**: the other Edge Functions (`auth` / `data` / `prices` / `chart` / `fundamentals` / `trading212`) wrap their top-level `Deno.serve` handler in a `try/catch` that writes a `<fn>.unhandled` row directly via the service-role key when an exception escapes — bypassing this function (and its token gate, since neither side of an Edge-to-Edge call has a user token) but going through the same `ops_errors` table so the admin badge surfaces it. Without that wrap an upstream crash returned a silent 500 only the browser console / Supabase logs saw. |
| `trading212` | `holdings` carries **every** position the broker reports, not just the two DCA'd ETFs — the allow-list existed to protect the user's ledger from an overwrite the client no longer performs, and narrowing the map hid real positions instead. `shapeT212Order` takes an optional skip-reason sink, so a history page that stores nothing reports *which field it was missing* rather than only how many items it dropped. |
| `trading212` (cont.) | `GET /functions/v1/trading212` → `{ holdings: { 'VUAA.L': { shares, cost }, 'SAEM.L': { ... } }, prices: { 'VUAA.L': 98.4, 'AAPL': 234.5, … }, updatedAt, source: 'cache' \| 'live' \| 'stale' \| 'disabled' }`. Two maps with different jobs. **`holdings`** is the auto-sync allow-list (VUAA.L / SAEM.L, the two USD-denominated UCITS ETFs the user DCAs into via T212's cashback + Spare-Change auto-invest — both settle USD, which is why the GBP-denominated VUAG.L / SEGM.L were swapped out; auto-invest in USD against GBP ETFs added an FX-haircut per micro-buy). Only these get shares/cost mirrored: `averagePricePaid` taken as **per-share USD AC** (settle currency, not GBp/pence), folded client-side into a single synthetic lot. **`prices`** is `currentPrice` (USD) for EVERY recognised T212 holding via a generic ticker map (`AAPL_US_EQ → AAPL`, `VUAAl_EQ → VUAA.L`), no extra API call — it comes in the same `/equity/positions` row. **Renamed / merged tickers** need a `T212_US_ALIASES` table on top of the generic rule: T212 assigns an instrument's internal code at first listing and never rewrites it through a rename / SPAC merger, so the API still returns `FB_US_EQ` for Meta, `YNDX_US_EQ` for Nebius, `IIVI_US_EQ` for Coherent, `VACQ_US_EQ` for Rocket Lab, `LOKB_US_EQ` for Navitas, and `GOOGL_US_EQ` for Alphabet — the generic rule would map those to the stale symbol (FB/YNDX/…) which never matches the board, so the overnight price silently never landed (the bug for META/NBIS/COHR/RKLB/NVTS/GOOG). The alias table maps each stale code → the current Yahoo ticker; it's price-map only and does NOT add them to the shares/cost allow-list. It also carries codes no suffix rule can derive — `2DGd_EQ → 2DG.SG`, a German listing whose 29 fills (net 580 shares, the board's entire position) had no ticker at all. Separately the generic US rule now accepts a share class: `BRK_B_US_EQ → BRK-B`, which failed to match on the inner underscore. The client (`trading212.js` → `applyTrading212NightPrice`) uses `prices` ONLY as an **overnight ("night market") quote**: during the 20:00–04:00 ET overnight window (`usMarketPhase() === 'overnight'`) with the Extended Hours toggle on, for any **US equity** the user also holds in T212 it swaps T212's price into `extPrice` (+ `extPriceTrusted`, `extDayPct` vs the RTH close) so metrics shows the broker's overnight print. Regular / pre-market / after-hours keep the original Yahoo logic untouched; the LSE ETFs (not US equities), OTC ADRs with no overnight session (e.g. SFTBY, gated client-side by `hasOvernightSession`), and any T212 stock not on the board are skipped, so HOOD (held on Robinhood, never in the T212 response) is unaffected. Calls `https://live.trading212.com/api/v0/equity/positions` (the current endpoint; it nests the ticker under an `instrument` object and names the cost field `averagePricePaid` — `shapeT212Portfolio` also reads the legacy flat `ticker` + `averagePrice` shape) with one of two auth schemes. T212's documented public API takes the API key as the raw `Authorization` header value (no `Bearer ` prefix; see [t212public-api-docs.redoc.ly](https://t212public-api-docs.redoc.ly/)), but two-key accounts authenticate with HTTP Basic (`base64(key:secret)`). `T212_API_KEY` is required; `T212_API_SECRET` is optional. **When a secret is set the function goes straight to Basic** and only falls back to the raw key on a 401 — these accounts 401 the raw-key attempt, so trying raw first burned a doomed round-trip AND fired a second request inside the same second, risking T212's 1-req/s limit (a 429 on the real call). Without a secret it's raw-key only. Both keys are Supabase secrets, never in the client bundle. **Two accounts**: T212 scopes its public API per account, so the ISA account's holdings + their live overnight prices need their own key — set `T212_ISA_API_KEY` (+ optional `T212_ISA_API_SECRET`) and the function fetches both portfolios in parallel and merges them via `mergeShaped` (prices union'd; allow-list shares/cost summed for any ticker held in both). Invest is primary; an ISA fetch failure degrades to invest-only. Without an ISA stock's price in the merged map the client falls back to Yahoo's stale after-hours close for that ticker's overnight dot — the bug this closes. `cost` is **per-share AC**, matching the convention `lot.cost` / `h.cost` use elsewhere (computeMetrics multiplies by `shares` for total cost). Client-side, `fx.js` keeps a `TICKER_CURRENCY_OVERRIDES` map pinning `VUAA.L`/`SAEM.L` → USD, because the default `.L` → GBP suffix rule in `detectCurrency` would otherwise mis-convert their USD prices by the GBPUSD rate (~1.27×). **Server-side 1 s cache** in `trading212_cache`. An **atomic Postgres claim** (`try_claim_t212_refresh` RPC in migration `0008`, a conditional UPSERT that bumps `updated_at` only when the row is older than the TTL and returns whether it actually wrote) guarantees at most ONE upstream T212 call per second across every device — within T212's 1-req-per-second limit on `/equity/positions`. The 1 s TTL replaced the old 30 s / 120 s windows once the endpoint moved off the harder-limited `/equity/portfolio`: a 1 s floor keeps manual refreshes feeling instant (a click lands fresh data unless the last upstream call was under a second ago) while staying inside the rate limit. The cached `data` is `{ holdings, prices }`; `unpackCache` treats a legacy holdings-map row as `{ holdings, prices: {} }` so a deploy doesn't blank the response before the first live refresh. Only the claim winner calls T212; losers re-read the cache. Stale-tolerant for 5 min on T212 errors. **Token-gated**: requires the same HMAC-signed `x-app-token` the `data` / `ops-error` functions use — both admin and ro tokens accepted but anonymous callers get 401. Holdings are PII; an open endpoint would leak the owner's share counts and cost basis. Returns `source: 'disabled'` + empty maps when `T212_API_KEY` is absent so the function deploys safely before the secret is configured. **`?action=orders-sync` walks the executed-fill history** one page per call into `t212_orders`, remembering the cursor per account in `t212_orders_sync`. A page only freezes the cursor when NOTHING on it parsed (or a `fill` arrives that isn't an object): treating one unreadable row as an unreadable page held both account cursors still for the entire life of the feature — the ISA account stored nothing at all and the invest account stopped a month back — and because a frozen walk never latches `complete`, the top-up pass that re-reads page one for today's fills never ran either. A negative nested `fill.quantity` is read as a SALE rather than dropped (`order.side` overrides the sign when stated), and a fill with no `fill.price` is priced off `walletImpact.netValue` — cash that actually moved, unlike the order-level `limitPrice` / `filledValue`, which are still refused. `t212_orders_sync.last_error` tallies why rows were skipped, most common first. |
| `snapshot-record` | `POST /functions/v1/snapshot-record` — **cron-triggered** every 5 min, 24/7 (migration `0026` schedules it, `0029` owns its table), NOT user-facing. Reads `board_data`, quotes every board ticker through the token-gated `prices` function (minting itself a short-lived admin token) plus T212's own `currentPrice` for the allow-list, and upserts ONE row into `price_snapshots`: `{ ticker → native-currency price }` keyed by the 5-minute bucket. It records FACTS, not conclusions, and must never learn what the portfolio is worth — that is computed in exactly one place (`computeAt`). The previous version computed a USD value and a deposit figure server-side, which meant a second implementation of the ledger maths in TypeScript running beside the browser's in JavaScript; they disagreed, and wrote a `deposit_usd` that moved between 71k / 76k / 129k / 132k in two days with no money entering the account. Deliberately does not fall back to the holding's stored `lastPrice` when there's no live quote: that number is whatever the browser last wrote to `board_data` and could be days old, so stamping it with a fresh timestamp would turn stale data into fake history. **Auth: bearer `CRON_SECRET`**, so it deploys `--no-verify-jwt` (in `PUBLIC_FNS`). Pure helpers pinned by `index.test.ts`. |
| `overnight-record` | `POST /functions/v1/overnight-record` — **cron-triggered** (pg_cron every 5 min across UTC 0–9; see migrations `0016` → `0019` → `0020`), NOT user-facing. Fetches T212 `/equity/positions` once and upserts every US-equity holding's `currentPrice` into `overnight_intraday_points` keyed by `(ticker, 5-min bucket)`. Gated on the composed `shouldRecord` predicate — the overnight window (20:00–04:00 ET), NOT the weekend dead zone (Fri 20:00 → Sun 20:00 ET), and NOT a full-day US holiday (`isHolidaySession` → the shared `_shared/us_market_calendar.ts`; the overnight session belongs to the trading day it ENDS on, so an evening bar keys off tomorrow) — all via `America/New_York` `Intl` (DST-safe). The handler calls the COMPOSED predicate (it previously re-derived the gate from the two raw checks and silently missed the holiday term), so a holiday like Jul 3 records nothing at the source. Reuses the trading212 ticker mapping (incl. the rename-alias table) + Basic-first auth + the ISA second account; excludes SFTBY (`hasOvernightSession`). **Auth: bearer `CRON_SECRET`** — and because that's not a Supabase JWT, this function deploys with `--no-verify-jwt` (in `PUBLIC_FNS`); otherwise the platform's JWT gate 401s the cron before our check runs. Pure helpers (bucket floor, overnight/weekend gates, ticker map, price extraction) pinned by `index.test.ts`. |
| `overnight-fetch` | `GET /functions/v1/overnight-fetch?tickers=NVDA,AAPL` → `{ "NVDA": [{date,close,volume:0}, …], … }` — the recorded overnight points per ticker over the last ~26 h, oldest-first, in the chart's standard series shape. Anon-readable (client sends the anon Bearer, same as `chart`). The modal splices these onto the Yahoo series to draw a real overnight **line** instead of the single heartbeat dot. The PostgREST IN(…) query is **paginated** (`paginateRows` loops `?limit=&offset=` until a short page returns) because a single ~40-holding fetch covers ~12 k rows, well over PostgREST's default 1000-row page — and the query orders by `ticker.asc`, so without pagination the alphabetically-later names (NVDA / ORCL / TSM …) were silently truncated and the modal showed "dot until the single-ticker fetch caught up" only for them. Pure helpers (`parseTickers` charset/cap, `groupRows`, `paginateRows`) pinned. |

Every Edge Function's pure helpers (range filtering, HMAC token sign / verify, ticker classification, TTM rolling-sum, market-hour predicate, anti-spam clipper) are exported and pinned by a co-located `index.test.ts` so a `deno test supabase/functions/` run guards them just like vitest guards the client. The `Deno.serve(...)` entrypoint is guarded by `import.meta.main` so importing a function's helpers in a test does NOT bind a port. Cross-function tests (e.g. auth sign + data verify roundtrip) live next to one of the two and import the other directly.

The `fundamentals` function is internally split into six sibling files (Supabase Deno can import same-dir `.ts` freely): `_shared.ts` (types + env + constants + `isFundamentalsTicker`), `_caches.ts` (index + stock cache helpers), `_alphavantage.ts` (AV path + `resolveIndexPe`), `_yahoo.ts` (crumb handshake + quoteSummary + fundamentals-timeseries; now also reads `calendarEvents.earnings` for the UPCOMING EARNINGS panel), `_finnhub.ts` (fallback + 3Y-avg series), `_math.ts` (pure PEG / PE3Y / TTM helpers). `index.ts` is the thin HTTP handler + the `fetchStockFundamentals` orchestrator + re-exports of the pure helpers for tests.

Cross-function code lives in `supabase/functions/_shared/` (the deploy
workflow redeploys every function when anything under it changes):
`token.ts` is the single copy of the HMAC app-token machinery —
`b64url` / `sign` / `constantTimeEqual` / `verifyToken` — that `auth`
(issue side) and `data` / `trading212` / `ops-error` /
`overnight-fetch` (verify side) all import, so issue and verify can't
drift apart (each function re-exports what it uses so its own
`index.test.ts` keeps pinning the exact implementation its gate runs);
`ip.ts` is the one trusted client-IP extraction (`x-real-ip`, then the
LAST `x-forwarded-for` entry, then an `"unknown"` sentinel) shared by
`auth`'s lockout key and `ops-error`'s error-row IP; `ops.ts` is
`reportServerError`, the best-effort `ops_errors` insert every
function's top-level catch uses; `us_market_calendar.ts` is the rule-based
NYSE full-closure calendar (`isUsMarketHolidayYmd` / `isUsTradingDay` /
`isUsMarketHolidayAt`) — auto-computes any year (fixed-date + weekend-shift,
nth-weekday, Easter-derived Good Friday), used by `prices` (crypto
US-session anchoring skips holidays/weekends) and `overnight-record` (skips
recording on holidays). A byte-equivalent copy of the rules lives in the
browser client's `src/market_hours.js` (`isUsMarketHoliday`, different
runtime — kept in sync); `us_market_calendar.test.ts` pins the exact
closures for 2026-2030 so a regression in the rules can't quietly mark a
trading day open or a holiday closed.

### `supabase/migrations/`

| File | Contents |
|---|---|
| `0001_auth_attempts.sql` | `auth_attempts` table + `bump_auth_attempt` RPC for atomic increment-or-lock. |
| `0002_ops_errors.sql` | `ops_errors` table with timestamped indexes; RLS-deny default. |
| `0003_index_fundamentals_cache.sql` | `index_fundamentals_cache` table — server-side 24 h cache of index trailing P/E from Alpha Vantage so the `fundamentals` Edge Function stays well under AV's 25-call/day free tier. |
| `0004_ops_errors_retention.sql` | `pg_cron` job at 03:00 UTC daily that drops `ops_errors` rows older than 30 days. Keeps the table bounded and the badge's `?action=summary` scan tight. Apply once via Supabase SQL Editor — pg_cron-scheduling SQL doesn't propagate through the edge-functions deploy workflow. |
| `0005_analyst_estimates_cache.sql` | `analyst_estimates_cache` table — server-side 7-day cache of FMP analyst-consensus 3y EPS-growth CAGR that once fed PEG. Retired by `0006` after PR #114 dropped the FMP layer; kept in history because it was applied to production. |
| `0006_drop_analyst_estimates_cache.sql` | Drops `analyst_estimates_cache`. PEG now uses the **blended 2y forward EPS-growth** (mean of `earningsTrend.trend[0y].growth` and `[+1y].growth`) computed inline in the `fundamentals` Edge Function — Yahoo retired its `+5y` long-term-growth bucket in May 2026 so the prior single-bucket approach went null. Either way the cache table is dead weight. Forward migration rather than an edit to `0005`. |
| `0007_trading212_cache.sql` | `trading212_cache` table — single-row (id=1) server-side cache of the Trading 212 portfolio snapshot (1 s TTL in the Edge Function, matching T212's 1-req-per-second limit on `/equity/positions`). Lets the `trading212` Edge Function fan-out to N visitors without each visit firing a fresh upstream call. RLS-deny default. Apply once via Supabase SQL Editor — the edge-functions deploy workflow doesn't run migrations. |
| `0008_trading212_claim_refresh_rpc.sql` | `try_claim_t212_refresh(ttl_ms int) → boolean` RPC — atomic conditional UPSERT against `trading212_cache` that bumps `updated_at` only when the row is older than `ttl_ms` (or no row exists) and returns whether it actually wrote. Kills the boundary race the TTL alone can't: two Edge Function workers passing the freshness check in the same millisecond can't both claim the refresh, so at most one of them calls live T212 per window regardless of how many devices are refreshing. `security definer` + `grant execute … to service_role` so only the Edge Function (authed as service role) can fire it; anon / authenticated callers can't force a refresh. Apply via Supabase SQL Editor after `0007`. |
| `0009_board_data.sql` | `board_data` table — single-row (id=1) jsonb store for the user's portfolio. Originally created ad-hoc via the dashboard SQL editor; this file records it so a fresh clone / db-reset has a deterministic recipe. `if not exists` — safe to re-run against the live project. |
| `0010_stock_fundamentals_cache.sql` | `stock_fundamentals_cache` table — keyed by `(symbol, include_eps_hist)`, 2 h TTL in the Edge Function. Without it a 30-ticker page load with the P/E chart open burns ~120 outbound Yahoo calls (4 per stock — quoteSummary + chart-price + EPS-history + revenue-history); with it the first visitor pays the cost and the next 2 h are cache hits. `include_eps_hist` in the key because the heavier history-on payload would otherwise be overwritten by the lighter shape mid-window. |
| `0011_auth_attempts_search_path_escalation.sql` | Hardens the `bump_auth_attempt` RPC from `0001`: explicit `search_path = public, pg_temp` (closes the schema-shadow attack the original didn't lock; brings 0001 to parity with 0008) AND escalating lockout — each repeat threshold-cross doubles the lockout window (24 h → 48 h → 96 h ...), capped at 30 days, via a new `lockouts` column on `auth_attempts`. A brute-forcer who patiently waited the original 24 h could try 3 wrong / wait 24 h forever; doubling makes their expected time superlinear while a legitimate user (who only triggers a lockout once) pays the unchanged 24 h. Apply via Supabase SQL Editor after `0001`. |
| `0012_av_quota.sql` | `av_quota` table + `try_claim_av_call(max_calls int) → boolean` RPC — atomic per-UTC-day counter. The `fundamentals` Edge Function calls it before every live Alpha Vantage request and refuses to fire when the cap (20, 5-call buffer under AV's 25/day free tier) is reached. Protects against the cache-bypass scenario (RLS regression, env typo) where every Edge invocation goes cold and drains the daily budget in an hour. RLS-deny default. Apply via Supabase SQL Editor. |
| `0013_board_data_version.sql` | Adds a `version bigint not null default 0` column to `board_data` + a `save_board_data(_data jsonb, _if_match bigint) → jsonb` RPC for optimistic concurrency. The `data` Edge Function passes the client's `If-Match` header through as `_if_match`; the RPC returns `{ ok: false, conflict: true, current_version }` when the supplied version doesn't match the row's actual version (another tab / device wrote in between), and `{ ok: true, version }` after a successful atomic UPSERT + version-bump. `_if_match IS NULL` skips the check — backward-compatible path for pre-0013 clients and one-off scripts. Cold-project special case: if no row exists yet, `_if_match = 0` matches. The client (`portfolio_remote.js`) caches the version returned from every load/save and surfaces the conflict via a banner in `app.jsx` instead of overwriting. Apply via Supabase SQL Editor. |
| `0014_stock_fundamentals_cache_retention.sql` | `pg_cron` job at 04:00 UTC daily dropping `stock_fundamentals_cache` rows older than 90 days — the table UPSERTs a row per `(symbol, include_eps_hist)` on every miss and never deleted, so tickers the user once held / opened piled up. 1 h after the `ops_errors` sweep so they don't ramp together. |
| `0015_overnight_intraday_points.sql` | `overnight_intraday_points (ticker, bucket_time, price)` table, PK `(ticker, bucket_time)` for upsert-on-conflict. Holds the server-recorded overnight 5-min price samples that power the overnight line chart. RLS: anon/authenticated SELECT, service-role writes only. |
| `0016_overnight_cron.sql` | pg_cron schedule for `overnight-record` (every 5 min, UTC 0–9, covers 20:00–04:00 ET in both DST regimes) + a daily 10:00 UTC prune keeping 30 days. Originally posted `Authorization: Bearer <app.cron_secret>` sourced from an `ALTER DATABASE … SET app.cron_secret` setting — **superseded by `0021`**, which moved the secret into Supabase Vault after that `ALTER DATABASE` turned out to be permission-denied on this project (see `0021`'s comment for the full story: the setting silently never took effect, so the cron job 403'd against `overnight-record` and recorded nothing from 2026-07-15 until the Vault fix landed). |
| `0017_revoke_bump_auth_attempt_from_public.sql` | `revoke all on function bump_auth_attempt(...) from public` (+ re-grant `service_role`). `0001`/`0011` granted `service_role` but never revoked PUBLIC, so PostgreSQL's default PUBLIC EXECUTE left the auth-lockout RPC callable by the anon/authenticated PostgREST roles with an arbitrary `_ip` (a targeted-lockout vector). Brings it to parity with the three cache/data RPCs that already revoke PUBLIC. Apply via Supabase SQL Editor. |
| `0018_revoke_overnight_anon_read.sql` | Drops the anon/authenticated SELECT policy `0015` granted on `overnight_intraday_points` — each row's `ticker` enumerates a held symbol via bare PostgREST with the public anon key, side-stepping the token-gated Edge Functions holdings otherwise route through. `overnight-fetch` reads with the service-role key, so the app is unaffected. |
| `0019_day_session_record_window.sql` | Widens the `overnight-record` cron from `*/5 0-9 * * *` (US-overnight UTC window) to `*/5 * * * *` — the recorder now also serves the venue **day-session** window (07:00–21:00 Europe/London, for the sparse-tape `DAY_SESSION_TICKERS` like `2DG.F`), and the union of the two windows across two DST calendars is fragile as cron math, so the function's own DST-safe gates decide instead. Off-window fires early-exit (`outside-all-windows`). Same command/secret as `0016`; the daily prune job is untouched. |
| `0020_revert_day_session_record_window.sql` | Reverts `0019` — cron back to `*/5 0-9 * * *`. The T212 day-session recording for `2DG.F` was withdrawn in favour of client-side venue-grid rendering from Yahoo bars (`fillVenueSessionGrid`), so the 24/7 schedule bought nothing. |
| `0021_cron_secret_via_vault.sql` | Rebuilds the `overnight-record` cron job to source its bearer token from **Supabase Vault** (`vault.decrypted_secrets where name = 'cron_secret'`) instead of the `app.cron_secret` database setting `0016` used — `ALTER DATABASE … SET app.cron_secret` is permission-denied on this project (`42501`), so that setting never actually applied and the cron job had been 403ing against `overnight-record` silently since `0019` rebuilt the job (2026-07-15 → 2026-07-16, the entire overnight-line + T212 auto-sync pipeline recorded nothing). The secret's plaintext value is a one-off out-of-band `vault.create_secret(...)` call run directly in the SQL Editor (documented in this file's header comment) — never committed, so `cron.job.command` only ever contains a lookup-by-name, not the credential. |
| `0022_portfolio_snapshots.sql` | Time series behind the Investment Performance chart, plus `portfolio_snapshot_series(_since, _bucket_seconds)` — a bucketed read returning the LAST sample per bucket. Reading the raw table doesn't work: at 5-minute sampling a YTD window is ~60k rows, so a plain ascending LIMIT returns January and drops everything recent. Row count follows the chart's point count instead of the sampling rate. portfolio USD value + net deposited, sampled every 5 min. `ts` (floored to the 5-minute bucket) is the primary key, which makes the write idempotent — two writers sampling in the same bucket upsert one row instead of stacking two near-identical points. RLS-denied; writes come from `snapshot-record` (cron) and a US-RTH backup via `data?action=snapshot`. |
| `0023_t212_orders.sql` | Real purchase history from Trading 212, plus `t212_orders_sync` (the per-account backfill cursor). `/equity/positions` reports a POSITION — quantity and average price, no dates — which is why every synced ticker carried a single synthetic lot whose date could only ever be a guess. `/equity/history/orders` has the fills (published shape is nested `{ fill, order }`, not a flat ticker/filledQuantity row). Stored rather than fetched on demand because that endpoint is rate limited to a handful of calls a minute (against 1/second for positions) and the history is immutable once written. Keyed on T212's fill id so the backfill is idempotent and a part-filled order keeps both halves. RLS-denied; the `trading212` Edge Function is the only path in. |
| `0024_reset_t212_orders_sync.sql` | Restarts the T212 order-history backfill from page one after the nested `{ fill, order }` shaper landed. The first shaper stored nothing and still advanced the cursor, so a completed walk would only ever re-read page one (newest fills) and the skipped pages would stay skipped. Idempotent on a fresh database (`0023` creates an empty sync table). |
| `0025_t212_transactions.sql` | Archived cash/card movements from Trading 212 (`t212_transactions` + per-account sync state). The public API does not expose the app's `Net deposits` field and mixes card activity into these rows, so Investment Performance deliberately does **not** use them; it uses actual fills from `0023`. |
| `0026_snapshot_record_cron.sql` | pg_cron for `snapshot-record` every 5 min **24/7** (`*/5 * * * *`) plus a daily 10:05 UTC coarsen-prune. Bearer token from Vault `cron_secret` (same as `0021` / overnight-record). `prune_portfolio_snapshots()` keeps 5-minute density for 26 h, then last-per-30-min / 1 h / 4 h / 1 day matching the chart buckets, then drops rows older than 400 days. Not a 30-day wipe — YTD still needs the coarsened real series. |
| `0028_restore_pltr_position.sql` | One-off data repair. `migrate()`'s sold-out heal had deleted PLTR — a live ~$9,400 position — because its lot ledger is a complete 2024 round trip (6.5 bought, 6.5 sold) while 55 shares sat in the account, and it re-deleted it on every load. The code fix stops the bleeding but cannot know what the position was; this restores 55 shares at $123.29, puts the ticker back in the `CM` slot and records `t212PositionKey` so a future strip round-trips. The 2024 lots and sell are left untouched — they are real history; the missing piece is the later re-entry, whose date nothing on this side knows, and inventing one would be fabricating a transaction. Bumps `version` so an open tab hits the conflict banner instead of saving its stale copy over the repair. Two independently idempotent statements. |
| `0029_price_snapshots.sql` | Replaces recorded VALUES with recorded PRICES. `price_snapshots(ts, prices jsonb)` + `price_snapshot_series(_since, _bucket_seconds)` + `prune_price_snapshots()` (5-minute density for 26 h, then last-per-30 min / 1 h / 4 h / 1 day, drop at 400 days — not a 30-day wipe, because the longer ranges are the ones recording is supposed to stop reconstructing). Repoints the daily prune job. `portfolio_snapshots` and its RPC are left in place, unread and unwritten — a migration should not drop a table on the strength of "I believe nothing needs it". |
| `0030_restore_multiplatform_shares.sql` | One-off data repair. A T212 sync briefly took the broker's slice as a ticker's whole position on its first run, which deleted the shares held at another platform: SPCX 130→59, RKLB 160→148.5, HOOD 50→20. Restores the three totals and their blended average costs, leaving `t212Shares` / `t212Cost` at the broker's true slice so `applyTrading212`'s delta path resumes from the right place. Each statement fires only while the board still reads exactly the broker's slice — the damage state and nothing else — so it is idempotent. Bumps `version` so an open tab hits the conflict banner instead of saving its stale copy over the repair. |
| `0031_rklb_other_platform_lot.sql` | Adds the one purchase missing from RKLB's ledger: 11.5 shares at $48.18 on 2025-11-07, bought away from Trading 212 and recorded nowhere. SPCX and HOOD already carried theirs. Does not close the whole gap (118.5 T212 shares are still un-lotted, and arrive as the order backfill walks back); `shares` / `cost` untouched. Guarded on the absence of a 2025-11-07 row. |
| `0032_map_stored_fill_tickers.sql` | Backfills the Yahoo ticker on stored T212 fills whose internal code had no mapping when they were written: `2DGd_EQ` (29 fills, net 580 shares — the board's whole `2DG.SG` position, with no ticker on any of them) and `BRK_B_US_EQ` (a share class; T212 separates it with an underscore, Yahoo with a hyphen, and the generic `_US_EQ` rule matched neither). Both are fixed in `t212TickerToYahoo`, but the backfill walks BACKWARD and re-upserts only the pages it visits, so rows already stored keep their null. `XFABp_EQ` (8 fills, net 0) is left unmapped — nothing on the board corresponds to it. Touches only null-ticker rows. |
| `0033_mark_other_platform_lots.sql` | Stamps `src: 'other'` on the four purchases Trading 212 has no record of — SPCX 50 @ 105.40 and 21 @ 135.00, RKLB 11.5 @ 48.18, HOOD 30 @ 81.09 — so the fill rebuild (`applyFillLedgers`) can't take them. They are exactly each holding's excess over its broker slice (130 − 59, 160 − 148.5, 50 − 20), so with them kept and the rest rebuilt from fills every one of the three nets back to the board's own share count, which is the condition the rebuild refuses to act without. A one-off: rows added later in the lot editor stamp themselves. Guarded on the ticker carrying no marked row yet. |
| `0034_map_remaining_fill_tickers.sql` | Backfills the Yahoo ticker on the last three T212 codes that resolved to nothing: `XFABp_EQ` → `XFAB.PA` (Euronext Paris; the `p` suffix has no rule), `CSPX_EQ` → `CSPX.L` (an LSE UCITS ETF with no exchange letter at all), `QQQ3l_EQ` → `QQQ3.L` (the `l` rule matched letters only, so a digit in the ticker skipped it — fixed in the rule too). All three net to zero, so no holding is affected; they matter because the transaction history now lists trades for tickers the board no longer carries, and a closed round trip with no ticker is history that simply isn't there. Touches only null-ticker rows. |
| `0035_drop_overnight_yahoo_snapshots.sql` | Strips the stale overnight prices `snapshot-record` stored for US equities. Overnight (20:00-04:00 ET) Yahoo publishes no tape — `lastPrice` and `extPrice` are a frozen carry of the last regular print — and `recordablePrice` fell through to them whenever the T212 call (one fetch for the WHOLE book) timed out, so every holding in that sample dropped to its previous close together and the next sample lifted them all back. With Extended Hours on, the 24H portfolio line swung more than a percent several times an hour, all night. Fixed at the source in the same commit; this removes the rows already written. Scoped precisely: inside the US overnight window only, and only the keys naming a ticker `overnight_intraday_points` already covers — a CN fund, a German listing, crypto and the `.L` ETFs genuinely trade during the US night and keep their samples. Timezone-correct year-round (computed in America/New_York, not a fixed UTC offset). |
| `0036_price_snapshot_15m_band.sql` | Re-cuts one prune band in `prune_price_snapshots`: the 26 h - 8 d tier keeps the last row per **15** minutes, not per 30. That tier feeds the 1W chart, which moved to 15-minute bars, so it was coarsening away exactly the density the chart asks for and the recorded half of a 1W line drew at half the resolution of the fetched half beside it. Every other band already matches its range. Rows already coarsened cannot be recovered, so the seam heals as the eight-day window rolls forward. |
| `0037_agents.sql` | The agents feature's schema: `agent_strategies` (one row per rulebook per venue — `kind`, `venue`, `signal_venue`, symbols, `mode` paper / live / paused, capital, params; seeded with `rotation-1d`, `trend-4h`, `trend-1h`, `momentum-1d` on Revolut X reading Kraken's candles, and `rotation-1w-kraken`, `momentum-1d-kraken`, `trend-4h-kraken` on Kraken — all PAPER), `agent_risk` (one row of caps, per venue account and mode: max order $20, max exposure $100, daily loss $5, 40 orders a day, global pause, and `live_confirmed_at`, null until Davies says go — the tick refuses every live order while it is null), `agent_decisions` (every decision with the categorical state, the numbers behind it, the questions, the answers, the rule's and the final action, the risk verdict; unique per strategy, symbol and `bar_start`, which is the tick's claim on a bar), `agent_orders` (every order, paper or live, with the request as placed and the venue's reply; a live order starts as `pending` before the venue is called), `agent_candles` (the venue candles the loop reads, keyed by venue), `agent_basis` (both venues' quotes and the basis in bps, every turn) and `agent_backtests`. `agent_observations` (the categorical state on the forming bar, per strategy and symbol, written when it changes), `agent_locks` (the tick's lease: one turn at a time) and `agent_backtests`. Seeds also include `dislocation-1m` (Revolut X, BTC + ETH, paper) and `agent_risk.paper_exposure_usd` (the paper twins' own exposure cap). RLS on everything; the function uses the service role. Schedules `agents-tick-every-minute` → `POST /functions/v1/agents?action=tick` with the Vault `cron_secret`, same machinery as `snapshot-record`, and a daily prune (30 days of basis and observations, 120 days of candles, 3 days of 1-minute candles). Same cross-environment warning as `0016` / `0026`: the cron URL is production's host. |
| `0038_drop_dislocation_seed.sql` | Retires the `dislocation-1m` seed in place: adds `agent_strategies.retired_at`, sets it on the row and pauses it. The dashboard lists only rows with `retired_at` null and the tick only paper / live ones, so the rule leaves the page and never ticks, while its decisions, orders and observations — which reference the row by foreign key — stay as the record. The rule was seeded as a measurement (reference §3.5 — the study behind it had measured stale last-trade prints); for seven hours the touch never came near its 15 bps entry, then its one trade lifted a "cheap" ask and was stopped out 50 bps lower a minute later — prices from Revolut X's EEA book, which this UK account cannot trade (the venue client mixed the two regions' tickers; fixed in the same push). Davies had asked for it to go. The file's first version deleted the row, was refused by the foreign key from `agent_decisions`, and never applied; the rulebook code stays, and un-retiring is a migration. `agent_basis` is untouched and keeps being written every turn. |
| `0039_trend4h_adds_avax.sql` | AVAX/USD joins the 4-hour trend rule on both venues, paper — the one candidate of four (DOGE, LINK, ADA, AVAX: the Revolut X UK pairs under 10 bps with real volume) to clear the bar written before the numbers were looked at (reference §3.7): positive out of sample on Revolut X costs, drawdown under 35 %, at least half the parameter grid positive out of sample, positive on Kraken costs. Out of sample AVAX made +40 % on the chosen parameters and +12 % on the seeded ones (drawdown 12 %, 85 % of the grid positive, Kraken +37 % / +9 %) in a year when holding it lost 65 %. Nine trades, so paper. The two rows' paper capital goes from $60 to $80 so each of four symbols keeps a $20 slot; idempotent (skips a row that already has AVAX). |
| `0041_one_order_per_decision_attempt.sql` | Unique index on `agent_orders (decision_id, requotes) where decision_id is not null`. The decision insert is the tick's claim on a bar; this makes the order insert the claim on a decision's ATTEMPT, so a decision whose order never reached the book (no pair config, a size under the venue minimum, the confirmation or the credentials missing that minute) can be placed on a later turn without two overlapping turns both placing it. Re-quotes carry their own attempt number. Checked against the live table first: no pair appeared twice. |
| `0042_maker_probes.sql` | `agent_maker_probes` — the adverse-selection notebook. Revolut X is 0 % maker and 0.09 % taker and the loop crosses the touch, so "why not rest everything and pay nothing" is the standing question; §3.13 could not answer it, because on Coinbase candles with a synthetic bid the model says a resting order fills with a median delay of ZERO hours. Every time the loop takes the touch it also writes down where a post-only order WOULD have rested (the same side's touch), and later turns record whether the real book came back to that price, how long it took, and the mark 15 and 60 minutes after it resolved — that last gap IS the adverse selection, to be read against §3.13's 10–20 bps break-even band. A probe is never an order: nothing reads it into a position, a book, an exposure or a P&L, and a probe that fails to insert never costs an order. One `watching` flag is the tick's whole read (`watching=eq.true`, one partial index); it clears when the last follow-up mark lands. RLS on, no policy — service role only. |
| `0043_retire_three_testing_rows.sql` | Retires `momentum-1d-kraken`, `rotation-1d` and `rotation-1w-kraken` — paused with `retired_at`, not deleted, because `agent_decisions` / `agent_orders` / `agent_observations` reference them by foreign key (the same lesson `0038` learned when its first version tried DELETE). Reference §3.17 re-priced all seven rows on FOUR walk-forward windows: these three are 0.90–1.00 correlated with a row that stays, worse in every window than the row they duplicate, and two of them breach §4.15's 35 % drawdown limit in the bear year. `trend-1h` is kept, reversing §3.14's two-window verdict: on four windows it is positive in all of them, has at least half its grid positive in all of them (the only row of seven), and is the best row in the sideways year — kept as a measurement row, not for its return, which is inside chance and inside the spread error bar. Nothing added: every candidate priced is inside chance. Row capital $440 → $280; no cap in `agent_risk` moves. |
| `0044_delete_retired_rows.sql` | Deletes the four retired strategy rows and everything under them — 4 rows, 11 orders, 35 decisions, 1,371 observations — on Davies' word ("retired 的 testing strategies 也都删了，不用留历史"). `0038` and `0043` had retired them IN PLACE because a strategy row cannot be deleted while `agent_decisions` references it; this deletes the children first, which is what those migrations would not do. Irreversible, and the migration is the only record of what went: `dislocation-1m` (flat), `momentum-1d-kraken`, `rotation-1d` and `rotation-1w-kraken` (all three still long in paper, so nothing is stranded at a venue). `agent_basis` and `agent_candles` are untouched — they carry no strategy id and are venue measurements, not a rule's record — and every number these rows produced is still in the reference (§3.4, §3.5, §3.14, §3.17). |
| `0040_trend4h_adds_sui.sql` | SUI/USD joins the 4-hour trend rule on both venues, paper. The whole top twenty by market cap (27 coins with the next tier) was run on 2026-09-21 (reference §3.8); eight cleared the one-window bar, and when the same four tests were run with the middle third held out only SUI and POL cleared both windows. POL trades $10.7k a day on Revolut X's UK book and waits; SUI (+14.5 % out of sample, drawdown 27 %, 85 % of the grid positive, Kraken +10.1 %; +3.0 % on the middle third with 70 % of the grid positive; still +11.9 % with the spread doubled; $940k a day) joins, with its 42 bps round trip inside every number. Paper capital 80 → 100 for the fifth $20 slot; idempotent. |
| `20260817034719_portfolio_snapshots_out_of_band.sql` | Reconciliation placeholder (no DDL). The MCP connector applied `0022` a second time and recorded this timestamp version; without a matching local file, `db push` refuses to run. |
| `20260818044126_t212_orders_out_of_band.sql` | Same, for the out-of-band apply of `0023`. |
| `20260818044956_drop_aug17_fx_spike_snapshot.sql` | Same, for the out-of-band DELETE of the 17 Aug FX-spike snapshot row. Display-side `dropDepositSpikes` still repairs any future one-sample jump. |
| `20260818083328_strict_t212_fills.sql` | Clears the order rows previously fabricated from order-only envelopes (limit price / created time are not execution facts) and restarts both order cursors. Until the strict nested-fill walk completes, client and cron keep the board ledger; partial fill history can never replace Deposited. |

> The `0022`-`0026` rows above and the four `202608...` placeholders create objects that are **already applied in the production database** but are not used by the application code on this revision — the Investment Performance work they were written for was rolled back to `8d869fe`. The files stay because `supabase db push` reads `supabase_migrations.schema_migrations`: delete a file whose version is recorded remotely and every later push fails with *Remote migration versions not found in local migrations directory*. See `supabase/migrations/README.md`.

### Build / config

| File | What it does |
|---|---|
| `docs/agents/go-live.md` | The go-live brief (2026-09-21, §1 and §9 updated 2026-09-22): what each row trades and with how much, how one trade happens minute by minute, where the edge is claimed to come from, the expected return as the two walk-forward windows report it (never averaged), what the fills cost on each venue, the risk layer, and a recommendation with its reasons — **`trend-4h` on Revolut X live, everything else paper** — plus what can still go wrong. It leads with the portfolio study's verdict: of the 21 shipped strategy × coin × venue members, none clears the bar on both windows. **§9 is the pre-live verification (2026-09-22)**: eleven checks against production with their results, the mode-in-the-position-key defect it found, the two cap facts to know before the switch (the exposure cap is marked to market, so it tightens on a winning book; $5 a day is 5 % of a $100 row), the one box left that needs an operator credential (the read-only `probe`), and the order of operations — including that moving the draft migration into `supabase/migrations/` IS the act of going live. |
| `docs/agents/0045_go_live.sql.draft` | The live migration, **deliberately not under `supabase/migrations/`** — a file there is applied by `migrations.yml` on the next push to main, so this one waits in docs until Davies says the word, and moving it is the act of going live. It adds ONE live row, `trend-4h-live` on Revolut X (BTC/ETH/SOL/AVAX/SUI, five equal $20 slots, $100), sets `agent_risk.live_confirmed_at`, and raises `max_exposure_usd` $100 → $150 — not a loosening, because the rulebook does not pyramid, so five coins at a $20 per-order cap deploy at most $100 of capital whatever the number says; what it fixes is that exposure is derived as base × MARK, so four slots up 6 % refused the fifth entry. `trend-4h` stays paper as the live row's control, which is the only thing that can measure a live Revolut X fill against the paper assumption of the touch plus 9 bps. Dry-run inside a self-rolling-back transaction: 4 → 5 rows, caps as intended, production untouched. |
| `docs/agents/reviews/` | Evidence, verbatim: the independent pre-live code review of the agents feature (2026-09-21 — seven blockers, sixteen should-fixes, the tests it found missing), the **Kraken venue study** (§3.12 — can Kraken earn 80 bps at any speed: no, 12 two-window passes against 14.6 expected by chance, and Revolut X wins 18 of 18 paired comparisons), the **allocation study** (`backtest_allocation.ts` → `backtests/allocation.json`, reference §3.11 — should each coin get the same money, where capital should sit across rows and venues, which rulebooks earn their place; its answers: equal slots because nothing beat the null on both windows, everything into `trend-4h` on Revolut X, and no real money on Kraken because a round trip there needs ~9.7 days to pay for itself where a Revolut X major needs 2.4 and these rules hold 0.6–3.4) and the portfolio study (`backtest_portfolio.ts` → `backtests/portfolio.json`: is the shipped set the best set, parameter and stop stability on both walk-forward windows, the regime filter across 27 coins, Kraken-only candidates, sizing) and the **execution study** (`backtest_execution.ts` → `backtests/execution.json`, reference §3.13 — can every Revolut X order rest at 0 % maker, is the two-bar cooldown right, is the stop pair right, is all-in / all-out right; its answers: no, the fee saving is a one-window win once the duplicated stop is corrected and nothing here knows whether a resting bid fills; yes, the cooldown is on a flat plateau; no, the intrabar ATR trail duplicates the rulebook's own; yes, scaling loses on both windows) and the **Kraken standalone study** (`backtest_kraken2.ts` → `backtests/kraken2.json`, reference §3.14 — is there any Kraken-only strategy, keep or delete each TESTING row, what is worth adding; its answers: no, in 952 coin-window cells Kraken beats Revolut X's fee schedule on the same rule exactly zero times and 12 two-window passes fall short of the 16.28 chance gives; delete `trend-1h`, `momentum-1d·kraken` and both rotations, keep `momentum-1d·revx` unoptimised and `trend-4h·kraken` for its fills alone; three paper candidates, all at chance on return) and the **third-window study** (`backtest_windows.ts` → `backtests/windows.json`, reference §3.15 — does a coin that cleared one window clear the next; its answer: no, zero or one coin of 22 clears three windows against a null of 0.33–1.50 on every arm, and a coin that cleared window A was LESS likely to clear window B than one that failed it, which closes the one-window-seat question and POL's case with it; it also prices the first SIDEWAYS year, the only one of four the live rule loses in), the **tape study** (`backtest_tape.ts` → `backtests/tape.json`, reference §3.16 — what it costs that the loop reads Kraken's candles while every table is priced on Coinbase's; its answer: median 4.03 points and up to 70, with NO direction (149 cells vs 139, p = 0.596), so the recommendation is unchanged, the per-coin figures are not, and the fix is the labelling rather than the arithmetic), the **fill study** (`backtest_fill.ts` → `backtests/fill.json`, reference §3.18 — what it costs that the loop decides on one venue and fills on another; its answer: 0.057 bps a round trip, 0.29 % of the cheapest round trip, with no direction over 296 real fills, so the split changes no verdict — but a Coinbase-fill PROXY errs by 4.93 points because a stop fires on the low, the one price venues agree on least) and the **set study** (`backtest_set2.ts` → `backtests/set2.json`, reference §3.19 — the coins, the weights, the mechanics and the venue re-asked on four windows and three tapes; its answer is that **nothing changes**, with the margin behind each: 0 add candidates admitted by the bar, 0 of 6 weightings beat equal slots in the bear year on any tape, 0 of 42 mechanics arms beat the shipped setting on every window, and the two venues' cost schedules do not overlap by 26.2 bps) and the **TESTING-set study** (`backtest_testingset.ts` → `backtests/testingset.json`, reference §3.17 — nothing repairs the sideways year (0 of 33 gate arms; everything that helps it helps by being out of the market, and that is what costs the strong bull, ρ = −0.85), three rows retire, nothing is added, and `trend-1h` is kept against §3.14's two-window verdict). The reference and the ledger say what was done about each. |
| `docs/agents/reference.md` | Everything verified about **TypeSafe: Jev 1.13** (the System One decision model behind the planned Agents feature — typed questions in, probabilities out, no text; released 2026-09-17, in no model's training data) and the **Revolut X REST API** (Ed25519-signed, 0 % maker / 0.09 % taker, 1,000 orders a day, candles in minutes capped at 1,000 per call, history from Aug/Sep 2023), with the live measurements the design rests on: spreads (BTC 1.5 bps, ETH 2.1, SOL 3.1; everything else 6–12), the cost of a round trip on a $100 account, and two years of real hourly data run through simple long/flat rules net of those costs. §2b–§2c add Kraken and the measured cross-venue basis (no arbitrage), §3.3–§3.7 the walk-forward backtests of every rulebook — including the breakout, double-bottom and illiquidity-event ideas tested on 2026-09-20 (the illiquidity one earned a paper seed, made one losing trade on the wrong region's book and was retired by `0038`) and the 15-minute / 1-hour rules of §3.6, none of which survives the round-trip cost (raw output in `docs/agents/backtests/frequency.json`); §3.7 widens the universe to DOGE / LINK / ADA / AVAX behind a bar written before the numbers (positive out of sample on both venues' costs, drawdown under 35 %, a parameter plateau), which AVAX alone clears (`universe.json`); §3.8 runs the whole top twenty by market cap (27 coins with the next tier, `universe20.json`), adds a second walk-forward window and a liquidity floor to the bar, and adds SUI; §3.9 tests five rule ideas and adopts none. Ends with the design consequences (Jev as a decision node on categorical state, a one-minute loop that observes and protects with entries on closed bars, limit orders, BTC/ETH/SOL only, paper first, hard caps in code), the answered questions and the live probes. CLAUDE.md carries the short rules. |
| `scraps/agents-baseline-backtest.py` | The reproducible evidence behind that reference's §3: pulls two years of hourly BTC/ETH/SOL from Coinbase Exchange (keyless; `api.binance.com` is geo-blocked from this network, its Vision mirror is not) and runs SMA-cross, time-series-momentum, Donchian and hourly-RSI rules at 1h/4h/1d, gross and net of Revolut X taker and maker costs, no look-ahead. What it shows is the cost structure: anything trading more than ~0.3 times a day is deeply negative after fees, slow trend rules on 4h/1d keep almost all their gross. One window, in-sample parameters — not a forecast. `--cached` reuses `scraps/.ohlcv/` (git-ignored). |
| `scraps/verify-perf-matrix.mjs` | Browser matrix for the performance panel, run by hand (needs Playwright, which the app does not depend on). Serves the published directory the way Cloudflare Pages does — the committed `index.html` and hashed bundle, no dev server — intercepts every network call with a fixture whose right answer is arithmetic, then reads the legend, the axis ticks and the SVG path geometry back out of the DOM. Covers both views × all five ranges × (no recorded rows / sparse / full): 60 cases. This is what caught the +14.81 % vs +16.00 % disagreement above; the unit tests agreed with themselves and missed it. |
| `test/browser/app-sweep.mjs` | Whole-app browser sweep, same serve-the-real-bundle method, run by `npm run verify:browser` and **gated in CI** on every PR and push to main. Covers what the matrix does not: the scoreboard total (with FX applied), the heat map's flat threshold and its extended-hours em dash, Top Movers (including the CN fund that must never rank), the transaction history (auto-DCA tickers hidden, closed positions present, every sort control cycling, symbol click-through), the view tabs including keyboard (each tablist scoped by its `aria-label`, since Top Movers carries one of its own), Top Movers' `%` / `$` switch against closed-form dollar arithmetic from the fixture, and both breakpoints — 197 checks, including that 3M really draws its four-hour grid (a regression to a daily grid shows up as ~40 points where there should be ~260), that Top Movers' window switch re-ranks the book without touching the chart's range, and that the Investment view's RECORDED handover rule is absent on 24H (wholly recorded) but present on 3M (the window opens before recording began) — the 3M half is what proves recorded data reached the panel at all, since an empty feed also draws no rule. A **recovery pass** answers the first request for the holdings chunk the way production did on 2026-09-21 (the HTML shell, status 200, `immutable` for a year, `nosniff`) and requires the app to heal and reload exactly once with no RENDER ERROR screen, to open the page on the real chunk after the reload, and to have reported the failure as `chunk.load` and never `render.crash` (the harness's ops-error mock records every kind the app reports). The Agents section drives the page against a stubbed `?action=dashboard` and `?action=chart`: **a cold open first** — the agents chunk held back 700 ms, the menu clicked at once, and the page's own frame (title, close) must be up before its code arrives, then replaced in the same modal (the shared null-fallback Suspense boundary used to blank every open modal and show the home page through); then the scoreboard's four cells with their G/L figures in the "+$1,521 (+0.86%)" shape and no total, the venue cards (two-line head, the Kraken balance in pounds, unrealised and realised rows), no eyebrow line above the title, five strategy rows as a table on desktop and cards on the phone (one row a minute rule kept in the fixture so its "every minute" path stays covered), the status as a green dot beside every name with its words in the title and no status column, a Today column, venue badges naming the venue only, a 40-second-old observation keeping every row running while the last decision is 35 minutes old, the detail opening as a second stacked modal with no back button and a to-the-second countdown, one position tile, no description / backtest / basis / caps sections, its symbol tabs, exactly two fill marks on the chart SVG with buy and sell apart, the legend naming both in words, two rows in the fills table, the live-state pills and their ages, a tab swapping the pair, the ✕ returning to the list, a paused and an errored dashboard, and a `notReady` payload rendering the designed empty state instead of an error. **Its clock is pinned** (`CLOCK`, a fixed Thursday 23:00 UTC, set both on the fixture's bar dates and on the page via `page.clock.setFixedTime`): the app reads the real clock to decide whether an after-hours print can exist, so before pinning the suite passed only between 20:00 and 24:00 UTC and was red the rest of the day — moving the pinned instant into the regular session reproduces exactly the four `heatmap/ext` failures that used to look like a real bug. Browser resolution is Playwright's own; a container with a prebuilt Chromium can point at it with `PLAYWRIGHT_CHROMIUM_PATH`. Two whole-run invariants ride along: **zero uncaught and console errors**, and **every Edge Function call carries `X-App-Token`**. That second one pins a real outage: a client that sends the header to a function whose `Access-Control-Allow-Headers` omits it has the call killed by the browser's preflight, and every caller here has a quiet fallback, so it surfaces as a drifting scoreboard and a blank panel rather than as an error. |
| `vite.config.js` | React plugin, PWA plugin (Workbox precache + runtime caches for fonts), build output to `dist/` — it emitted to the REPO ROOT until 2026-09-18, which is why the live site published `handover.md`, `LEDGER.md`, `src/` and every Edge Function source (Pages defaults its output directory to the repository root when nothing configures one). The `data-api` runtime cache (Supabase / Yahoo / Cloudflare) is `NetworkFirst` with a **5-minute** `maxAgeSeconds` and a 10 s network timeout. Both numbers matter: NetworkFirst falls back to cache whenever the network is slower than the timeout, and the app counts that response as a completed refresh — it stamps "Last updated" and keeps the pill on LIVE, so the STALE indicator can't fire. The previous 6-hour window therefore let a phone on a slow connection be shown hours-old quotes labelled LIVE; the visible symptom was every US equity reading exactly 0.00 % with Extended Hours on (an hours-stale ext quote fails `extPriceIsRealAh`, which forces the ext branch to 0) while crypto / non-US rows, which never take the ext path, still looked alive. Offline use is served by the app's own caches (`dp.marketCache`, `dp.portfolioCache`, the IndexedDB chart stores), which render with honest stale/error affordances, so nothing depends on this cache surviving for hours. Bundle filenames pinned to lower-case hex hashes with an explicit `app-` prefix (`assets/app-{hex}.js`) so the URL can never contain a substring like `Ad`/`Ads` that AdGuard's content filter strips — caught one production outage where a build hash of `_Ad` made AdGuard's system-level proxy delete the `<script>` tag, blank-page-ing the site for users who had AdGuard. Hex (0-9a-f) is alphabet-safe against that whole class of false positive. |
| `tsconfig.json` | `checkJs: true` so JSDoc annotations get type-checked by `tsc --noEmit`. `strictNullChecks` is **on** — the `useState(null)` / `useRef(null)` slots carry JSDoc `@type` annotations so the null/undefined-bug class is caught; the rest of `strict` stays off until more files are annotated. |
| `eslint.config.js` | Flat ESLint config (ESLint 10). Deliberately a **bug** gate, not a formatting one: errors on `react-hooks/rules-of-hooks` (the hook-ordering class that shipped a React-#310 crash once) + `js.recommended` (with `allowEmptyCatch` for the codebase's best-effort-swallow pattern); `react-hooks/exhaustive-deps` is a non-blocking warning since a few effects intentionally narrow their dep set (documented inline). Stylistic / unused-locals are left to `tsc` + `knip`. `npm run lint`. |
| `_headers` / `robots.txt` | Cloudflare Pages cache rules (deliberately NO long-lived rule for `/assets/*`: a rule applies to every response on the path, and Pages' not-found fallback for a chunk that does not exist yet inherited "immutable for a year" on 2026-09-21 — see Hosting above), `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on every path with a matching `robots.txt` (a password-gated personal ledger should not be indexable, quotable or summarisable from a link, by a search engine or by an AI assistant following one — the header covers the JS bundle, which `robots.txt` alone does not reliably reach; neither is access control, and a fetcher that ignores the directive still gets the bytes — what stops a stranger reading the PORTFOLIO is the token gate on every Edge Function, and what stops them reading the SOURCE is that `dist/` holds only the minified bundle, no `src/` and no sourcemaps), **plus** the production security headers — Content-Security-Policy (scoped to the exact upstream origins the app talks to: Supabase, Yahoo, Eastmoney, Danjuanapp, Xueqiu, and the five public CORS proxies), Strict-Transport-Security (2-year preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geolocation/payment. `index.html` / `sw.js` always revalidate; `/assets/*` cached for a year (filenames are content-hashed). Source-of-truth lives at `public/_headers`; Vite copies it into `dist/` on build, where Pages reads it. |
| `manifest.webmanifest` | PWA install metadata (name, icons, theme color). |
| `.github/workflows/check.yml` | CI: typecheck → lint → vitest → build → size-limit → knip → dependency audit, all hard gates, on every push + PR. |
| `.github/workflows/edge-functions.yml` | Edge Function CI/CD. Runs `deno test supabase/functions/` on every PR; on push to `main` it also deploys every changed `supabase/functions/<name>/index.ts` via the Supabase CLI (requires `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` repo secrets). `PUBLIC_FNS` (`auth data trading212 ops-error overnight-record agents`) deploy `--no-verify-jwt` because their own gate is not a Supabase JWT. Replaces the manual paste-into-dashboard workflow that CLAUDE.md still mentions — once those secrets are set the workflow takes over and the dashboard step is optional. |
| `.github/workflows/migrations.yml` | Postgres migration CI/CD. PR-time SQL lint over `supabase/migrations/*.sql`; on push to `main`, `supabase db push` against the linked project (requires `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / `SUPABASE_DB_PASSWORD` repo secrets — the first two are shared with `edge-functions.yml`). |
| `.github/workflows/healthcheck.yml` | Scheduled (`*/10 * * * *`) uptime monitor **and Edge Function keep-warm ping** — opens/bumps a `health-failure` issue when a surface is down. Also the **deployment integrity probe**: fetches the live shell, follows it to the app chunk, extracts every lazy chunk it imports and requires each to come back `200` as JavaScript, then asks for a chunk that does not exist and requires a `404` with no `immutable` header — the check that would have caught the 2026-09-21 poisoning within ten minutes. Pings the site root plus every Edge Function on the app's first-load critical path: `overnight-fetch` (anon-readable, expect 200) and `prices` / `chart` / `fundamentals` / `data` / `trading212` (token-gated — pinged with NO app token on purpose, so a 401 proves the isolate booted without touching the DB or a rate-limited upstream; see each function's `verifyToken` ordering). Exists because Supabase Edge Functions have no documented min-instances/keep-warm config — an idle isolate goes cold, and cold starts chained across several functions (portfolio load → prices/chart/trading212, all gated behind the load resolving in `app.jsx`) were the dominant cause of "the first refresh after opening the app takes tens of seconds" while a second refresh inside the same session was fast. Not pinged: `auth` (lockout risk, no benefit), `overnight-record` (self-warms via its own pg_cron schedule), `ops-error` (write-only). |
| `CLAUDE.md` / `AGENTS.md` | Conventions for agent sessions working on this repo — gates, git identity, Edge Function deploys, and how an open PR's description is kept current. |
| `LEDGER.md` | **The live handover record**, under the ledger protocol. Three parts in order: what remains right now, the machine and platform setup as runnable commands, then history newest first with each section opening with a source header naming the platform and model. Read it first on any resume and work down the list. Kept small on purpose — every session on every platform pays context for it on every wake. |
| `docs/improvement-plan.md` | The whole-repository review of 2026-09-05, as an ordered plan: 28 items in four tiers, each with what it costs, what it risks, how it is verified, and whether it needs Davies at a console. A PROPOSAL — nothing in it has been executed. `LEDGER.md`'s what-remains list is the short version and points here for the reasoning. Deliberately free of anything attack-shaped, because the site currently publishes this file too (plan item 1). |
| `handover.md` | The ledger's **archive**: the append-only decision log and the raw session transcripts, 35k lines. Closed operations move here verbatim from `LEDGER.md`. Opened only when a closed item is reopened or audited. Quotes real positions — do not copy balances out of it. |
| `.ledger/` | The ledger protocol package, vendored from https://github.com/daviesluo/ledger-skill (Apache 2.0). `SKILL.md` is the protocol and the only file a session needs; `EXAMPLE.md` is a worked ledger; `bin/selftest.sh` extracts the hook from the protocol itself and exercises both gates in a throwaway repo (47 cases here). Deliberately NOT at a scanned path — pointers at `.claude/skills/ledger/`, `.cursor/skills/ledger/` and `.agents/skills/ledger/` name it, so every tool loads one copy and none can go stale. |
| `hooks/pre-commit` | The ledger's two gates, extracted from `.ledger/SKILL.md`: a commit with substantive changes must carry `LEDGER.md` or follow one that did, and a new history section must open with a well-formed source header. Reached via `core.hooksPath`, which — like `ledger.path` — is per-clone config a rebuilt container loses; `LEDGER.md`'s machine-setup section has both commands. Hatch is `LEDGER_OK=1 git commit`, not `--no-verify`. |

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
       │  Persistent state:
       │    ├── localStorage / sessionStorage (small, low-churn rows)
       │    │     ├── dp.token        (sessionStorage — wiped on tab close)
       │    │     ├── dp.auth         (failed-login lockout state)
       │    │     ├── dp.prefs        (hide-values toggle, etc.)
       │    │     ├── dp.marketCache  (last live tick's MC + FX snapshot,
       │    │     │                    seeds cold start so the portfolio
       │    │     │                    total + MC cards print right on
       │    │     │                    the first frame; max age 7 days)
       │    │     └── dp.schema       (single integer; bumps drive Storage.migrate)
       │    └── IndexedDB via idb-keyval (chart_store.js — bulk chart data)
       │          ├── ChartStore (per-ticker modal cache: chart series,
       │          │               FUND row, TTM-aware PE series)
       │          ├── MaStore    (MA overlay wider-history cache, separate
       │          │               object store)
       │          └── YtdStore   (PerfChart per-(year, range, ticker) cache)
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
npm test              # vitest (~399 client-side cases — YTD math + the applyVariantFilter window dispatch, indicators (incl. isPriceAxis live-tail gate + extPriceIsRealAh ext-trade verdict), cache + ratio-suffix key pins, ticker shape, fetch strategy + the CN-fund trimCnFundToRange, portfolio metrics + FX, lot sanitisation, market-cache + legacy fallback + the storage migrate/load/save pins, SW banner suppression window, ops-badge desktop gate, portfolio fingerprint diffing, fmtMoney magnitude tiers, applyTrading212 lots-merge + the allow-list T212 price override, the shared chart geometry incl. parseChartDateUTC + findRegularCloseIdx). Plus the `fundamentals` Edge Function helpers (TTM rollover, USD-anchor rescale, pickPsFields ADR guard, computeForwardGrowth blend, computePeg) and the `trading212` helpers (T212 → portfolio shape incl. the `/equity/positions` nested-`instrument` shape, ticker mapping, two-account `mergeShaped`, cache TTL, basic-auth + token verify) on the Deno side.
npm run typecheck     # tsc --noEmit with checkJs + strictNullChecks
npm run lint          # ESLint (react-hooks bug rules; warns on intentional dep-array narrows)
npm run build         # production bundle to dist/
npm audit --audit-level=high --omit=dev   # supply-chain check on shipped deps

# Edge Functions (Deno). Requires `deno` installed locally; CI runs the same.
deno test --allow-env supabase/functions/   # range filter / HMAC / ticker filter / TTM rollover / market hours / clip
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

**Recommended path** (after PR #158): set `SUPABASE_DB_PASSWORD` in
the `production` GitHub Environment alongside the existing
`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF`. The `migrations.yml`
workflow auto-runs `supabase db push --include-all` on every push to
main that touches `supabase/migrations/**`, applying files not already
in prod's `supabase_migrations.schema_migrations` table.

For initial bootstrap (or as a fallback if the workflow secrets
aren't set), paste and run in the Supabase dashboard → SQL Editor
**in order**:

- `supabase/migrations/0001_auth_attempts.sql`
- `supabase/migrations/0002_ops_errors.sql`
- `supabase/migrations/0003_index_fundamentals_cache.sql`
- `supabase/migrations/0004_ops_errors_retention.sql`
- `supabase/migrations/0011_auth_attempts_search_path_escalation.sql` *(re-declares `bump_auth_attempt` with explicit `search_path` and adds escalating-lockout windows; needs `0001` applied first)*
- `supabase/migrations/0009_board_data.sql` *(the `board_data` table the `data` function reads/writes)*
- `supabase/migrations/0010_stock_fundamentals_cache.sql` *(per-stock Fundamentals cache — the `fundamentals` function falls back gracefully when this table is missing, so this one is optional, but skipping it means every page load hammers Yahoo for fresh quote-summary + EPS-history per ticker)*
- `supabase/migrations/0007_trading212_cache.sql` — **only if you want the Trading 212 auto-sync.** Skip if you're not setting `T212_API_KEY`.
- `supabase/migrations/0008_trading212_claim_refresh_rpc.sql` — pair with 0007; the RPC references the `trading212_cache` table created in 0007.

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
  `edge-functions.yml` workflow will deploy any changed
  `supabase/functions/<name>/index.ts` on every push to `main`, after
  the `deno test` step passes.
- **Manual** — for each directory under `supabase/functions/*`, copy
  the contents into a new function in Supabase dashboard → Edge
  Functions, then Deploy. Use this for the first-time bootstrap or
  when you don't want to grant CI a PAT.

Required environment variables (Edge Functions → Settings):

A copy-pasteable shape of the app-level vars lives at
[`.env.example`](./.env.example).

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | Provided automatically by Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | `data`, `auth`, `ops-error`, `trading212` | From dashboard Settings → API. |
| `APP_AUTH_SECRET` | `auth`, `data` | Long random string (`openssl rand -hex 32`). |
| `APP_ADMIN_PWD` | `auth` | Your admin password. (The function reads this exact name — `APP_ADMIN_PASSWORD` leaves auth unconfigured.) |
| `APP_RO_PWD` | `auth` | Your read-only / shareable password. |
| `FINNHUB_API_KEY` | `fundamentals` | Free key from finnhub.io (60 calls / min). Source of `pe3yAvg` / `ps3yAvg` (3-year averages — Yahoo doesn't expose historical-annual ratios on the free tier) and the whole-row fallback for current pe/eps/ps when Yahoo's crumb handshake fails or it's rate-limited. Without it the P/E / P/S 1Y buttons still work for tickers Yahoo covers, but the dashed 3Y AVG reference line is hidden and a Yahoo outage drops the chart entirely. *(There used to be an `FMP_API_KEY` here — FMP retired its `/v3/` endpoints and paywalled the `/stable/` replacements in 2026, so the FMP layer was removed and Yahoo `quoteSummary` + a crumb handshake is now the primary source. No FMP key is needed.)* |
| `ALPHAVANTAGE_API_KEY` | `fundamentals` | Free key from alphavantage.co (25 calls / day). Powers index P/E for `^GSPC` / `^NDX` / `^RUT` / `^SOX` via their ETF proxies, with a 24 h server-side cache so the daily quota is never strained. Without it the function falls back to hardcoded constants — chart still draws but the printed values stop auto-refreshing. |
| `T212_API_KEY` | `trading212` | Optional. Read-only API key from Trading 212 → Settings → Account & Personal → API Settings. Powers the auto-sync of VUAA.L / SAEM.L lots — without it the function returns `source: 'disabled'` + empty holdings and the client falls back to whatever the user last typed into EditTickerModal. Sent as the raw `Authorization` header value per T212's documented public API. |
| `T212_API_SECRET` | `trading212` | Optional fallback for T212 accounts that use the two-key HTTP Basic Auth flavour. The function tries single-key auth (`T212_API_KEY` alone) first; if T212 returns 401 AND this secret is set, retries once with `Basic base64(key:secret)`. Leave unset for the standard documented scheme. |
| `T212_ISA_API_KEY` | `trading212` | Optional. API key for a SECOND T212 account (the ISA). T212 scopes its public API per account, so ISA holdings + their live overnight prices are only reachable with this key. When set, the function fetches the ISA portfolio in parallel and merges it with the invest account (prices union'd; allow-list shares/cost summed if held in both). Without it, only the invest account (`T212_API_KEY`) is synced. |
| `T212_ISA_API_SECRET` | `trading212` | Optional two-key Basic-Auth fallback for the ISA account, same role as `T212_API_SECRET` but for `T212_ISA_API_KEY`. |
| `CRON_SECRET` | `overnight-record` | Bearer secret the pg_cron job presents to the overnight recorder (it deploys `--no-verify-jwt`, so this is its only auth gate). Must equal the `app.cron_secret` the cron sends (migration `0016`). `openssl rand -hex 32`. Only needed if you run the overnight line-chart cron. |

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

- Build command: **(leave empty)**
- Build output directory: `dist` — but set in `wrangler.jsonc`, not the
  dashboard (`"pages_build_output_dir": "./dist"`).

This repo commits its built output to `dist/` (see `.gitignore`'s note),
so Cloudflare serves that directory **as-is** with no build step. You run
`npm run build` locally and commit the result before pushing (CI's bundle
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

Cloudflare Pages will auto-deploy on every push to `main`.

### 6. Visit

- `https://<your-domain>?pwd=<APP_ADMIN_PWD>` for full edit mode.
- `https://<your-domain>?pwd=<APP_RO_PWD>` for a read-only share
  link.

---

## Working conventions

See [`CLAUDE.md`](./CLAUDE.md) for repo conventions (push directly to
`main`, run tests + typecheck + build before every push,
schema-version migrations under `Storage.migrate()` in `storage.js`).
Edge Functions auto-deploy via `.github/workflows/edge-functions.yml`
on every push to `main` that changes a `supabase/functions/*/index.ts`
(gated by `deno test`); manual paste-into-dashboard is only needed
when the deploy secrets are missing.

When a PR is open, its description is maintained with the branch: every
push that changes the diff rewrites the summary in the same step, and
the summary covers only what the PR would add to `main` right now.
Cloudflare Pages gives each branch a preview at
`https://<branch-slug>.daviesportfolios.pages.dev` (branch name
lowercased, non-alphanumeric runs collapsed to `-`, truncated to 28
characters) — that link belongs in the description.
