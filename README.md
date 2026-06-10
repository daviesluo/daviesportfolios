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
- **Multi-currency holdings** — USD / GBP / EUR / CNY / HKD with live FX
  conversion against `GBPUSD=X` / `EURUSD=X` / `USDCNY=X` / `USDHKD=X`.
  Euro-zone tickers are detected by exchange suffix (`.PA` Paris, `.AS`
  Amsterdam, `.DE` XETRA, `.MI` Milan, `.MC` Madrid, …). Only the price
  and avg-cost render in the native currency; everything else converts
  to USD.
- **Chinese mutual funds** — 6-digit fund codes route to eastmoney's
  `pingzhongdata` endpoint, with `api.fund.eastmoney.com/f10/lsjz`
  and `danjuanapp.com` (Snowball) as JSON fallbacks.
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
  dot flips to `S&P 500 FUTURES` so the benchmark is unambiguous
  (panel title stays "PERFORMANCE VS S&P 500" — futures track the S&P).
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
  (1mo/30m for 1W, 3mo/60m for 1M, 6mo/1d for 3M, 1y/1d for YTD)
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
  fetch resolves (parallel `Promise.all`) so fast ranges (1D / 3M /
  YTD) land in cache without waiting on the slow ones (1M intraday).
  TTL-aligned per range (5 m / 30 m / 1 h / 12 h / 12 h); auto-refresh
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
  `/equity/positions`). The only slow window is the **weekend dead zone**
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

### Holding list (☰ menu)

- The **☰ menu** to the right of EDIT (both desktop + mobile) opens a
  dropdown; its one item, **Holding list**, opens a Yahoo-Finance-style
  sortable table of every holding: Symbol (+ company name), Exposure %,
  Cost Basis, Market Value, Day Change ($ / %), Unrealized G/L ($ / %).
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
  The displayed % is "since previous close" — anchored at the official
  regular close (`regularMarketPrice`), the same denominator
  `computeMetrics` uses — so it matches the scoreboard's DAY CHANGE and
  every heatmap tile exactly, ext-on included. While the modal is
  open the chart polls back-to-back (5 s minimum gap) so intraday
  bars trickle in without a manual refresh.
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
stocks use, with the full 1D / 1W / 1M / 3M / YTD / 1Y range row. `^GSPC`,
`^NDX` and `^RUT` additionally surface a **P/E 1Y** button (sourced
from the matching ETF's trailing P/E via Finnhub) with a 3-year-
average dashed reference line. Yields render with a `%` suffix, FX
pairs at four decimals, and indices / futures without a currency
prefix so the y-axis matches each instrument's natural scale.

### Sidebar

- **Top Movers · Today** — the five largest winners and losers by %
  change.
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

- **Frontend** — React 19 + Vite 8, JSX with `checkJs` + JSDoc for type
  safety (no `.tsx`). Bundle output to repo root (`/assets/*.js`),
  served by Cloudflare Pages. Runtime deps stay minimal (`react`,
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
  pointing at deleted hashed bundles.

---

## File map

### `src/` — client

| File | What it does |
|---|---|
| `main.jsx` | React entry point. Mounts `<App>` + service-worker registration. |
| `app.jsx` | `<App>` (auth gate) + `<Board>` (the actual UI). Owns portfolio state, `doRefresh` loop, modal coordination. |
| `auth.js` | Password → HMAC token flow. `collectPassword` (URL `?pwd=` or `window.prompt`), `authenticate` (POSTs to `/auth`), `decodeAppToken` (skip prompt if a valid sessionStorage token already exists). |
| `portfolio_remote.js` | `loadPortfolioRemote` / `savePortfolioRemote` against the `data` Edge Function. Includes `migrate(p)` for legacy portfolio shapes (CB → CB1/CB2 split, BRK-B move, currency backfill, lots backfill). Also exports `portfolioUserFingerprint(p)` — a stable string digest of just the user-edited subset (positions + per-holding shares / cost / lots / currency, with sorted keys for insertion-order invariance) used by `app.jsx`'s debounced save to skip writes when only price-refresh data changed; and broadcasts a `portfolio-saved` message on `BroadcastChannel('dp.portfolio')` after a successful save so other tabs on the same origin can refetch instead of carrying a stale copy. Together those two fix the multi-tab data-loss bug where a backgrounded tab's 30 s price refresh would re-serialise its stale shares/lots-with-fresh-prices snapshot and silently revert an edit made in another tab. **Optimistic concurrency** (per migration 0013): module-scoped `lastKnownVersion` is updated from every load/save response and sent as the `If-Match` header on the next save; on a 412 conflict reply, `savePortfolioRemote` returns `{ ok: false, conflict: true }` and `app.jsx` surfaces a "another tab saved newer changes" banner with Reload / Keep-editing CTAs (the version is also refreshed from the conflict response so a subsequent retry against the now-known version can go through cleanly). The fingerprint + BroadcastChannel close the common multi-tab race; the If-Match path closes the corner cases those don't (offline tab coming back, second device that wasn't subscribed to the channel, network round-trips overtaking each other). |
| `supabase_config.js` | Shared `SB_URL`, `SB_ANON`, `EDGE_AUTH_URL`, `EDGE_DATA_URL`. |
| `positions.js` | `POSITION_COORDS` — the 11 tactics-board slot coordinates on a 100×100 pitch (consumed by Pitch / Heatmap / app.jsx). The last real definition left in the old `utils.js` god-module barrel, which was retired in 2026-06 in favour of direct per-module imports (every consumer now imports straight from `yahoo_fetch` / `historical` / `market_hours` / `storage` / `fx` / `metrics`); `knip` is a hard CI gate now that the barrel's false positives are gone. |
| `portfolio_edits.js` / `portfolio_edits.test.js` | `createPortfolioEditHandlers({ setPortfolio, isReadOnly })` — the six tactics-board edit reducers (updateHolding / removeHolding / swapPositions / moveHolding / addHolding / updatePosition) lifted out of `app.jsx`. Each is `setPortfolio(p => next)`, a pure transform the test exercises by capturing the updater; all no-op in read-only mode. |
| `storage.js` | `Storage` namespace (`dp.auth` / `dp.prefs` / `dp.schema` / `dp.marketCache` / `dp.opsErrorAck`) with single-version schema migration. `loadMarketCache` / `saveMarketCache` persist the last successful `fetchTickers` reply (FX pairs + MC tickers) and hydrate the next cold start so the portfolio total + MC cards paint correct values on the first frame instead of flashing 1:1-USD fallbacks. Chart caches (`dp.tickerChart` / `dp.maCache` / `dp.ytd`) live in IndexedDB via `chart_store.js` to escape the localStorage 5 MB quota; this module only carries the small / low-churn rows that stay under it (so `writeJSON` just returns false on the now-very-unlikely quota error — the old "halve the largest chart row and retry" fallback became dead once the bulk caches moved to IDB). `loadMarketCache` (7-day expiry + legacy `dp.fxCache` fallback + per-row validation), `saveMarketCache`, and `migrate` are pinned by `storage.test.js`. |
| `market_hours.js` | DST-aware time helpers (`londonTimeParts`, `centralEuropeTimeParts`, `usMarketPhase`, `ukTzAbbr`, `usMarketHoursUtc`, `lseIsOpen`, `euroExchangeIsOpen`, `isUsMarketHoliday`). All `Intl`-based so DST cutovers are resolved by the runtime. `usMarketPhase` returns `overnight` (market closed) on weekends AND full-day NYSE holidays — `isUsMarketHoliday` computes the calendar rule-based (nth-weekday + fixed-date with the correct weekend-observance shift, New-Year's-on-Saturday exception, and Good Friday from Easter) so there's no date list to maintain and, by construction, no chance of mislabelling a real trading day as closed. Half-day early closes (~3/yr) are NOT modelled — those are genuinely open, just until 13:00 ET. `lseIsOpen` / `euroExchangeIsOpen` gate the ext-hours toggle in `metrics.js` for venues with no US-style pre/after session — every `.L` ticker (VUAA.L / SAEM.L on the T212 sync, plus any user-added London listing) and every euro-zone ticker (`.PA`/`.DE`/`.MI`/… per `isEuroExchange`) shows 0 % when its own exchange is closed and the live local pct only while it's actually trading. `euroExchangeIsOpen` uses one 09:00–17:30 CET window (`Europe/Paris`) that covers Euronext / XETRA / Milan / Madrid / Vienna / Helsinki / Athens. |
| `proxy_chain.js` | The 5-host public CORS-proxy list + per-proxy backoff cache (`proxyIsAvailable`, `markProxyDead`, `clearProxyBackoff`). When a proxy returns 429 / 403 / 5xx it's blacklisted for 10 minutes (1 minute for plain timeouts), so one dead host doesn't poison every 30-second refresh tick. Cleared on first successful response from that proxy. In-memory only; resets on page reload. Imported by `yahoo_fetch.js` + `historical.js`. |
| `yahoo_fetch.js` | The live-price pipeline. Edge-first (`/functions/v1/prices`) with the per-proxy fallback chain consulted only for tickers Edge dropped. Public surface: `refreshPrices`, `fetchTickers`, `fetchFundamentals`. `fetchOneYahooChart` (the proxy-side single-symbol fallback) now suppresses `extPrice` for any ticker with a dotted suffix (`.L`, `.HK`, `.SS`, …) — Yahoo's `preMarketPrice` / `postMarketPrice` for those reflects the local exchange's live intraday quote, not a US-style pre/post session, so the ext-hours toggle would otherwise leak real LSE intraday movement when the user expects 0. |
| `historical.js` / `historical.test.js` | Chart-data fetch. `fetchHistorical` (single-symbol proxy race), `fetchCnFundHistoryViaProxy` (danjuanapp + xueqiu race for 6-digit CN funds), `fetchHistoricalBatch` (Edge-first, proxy-fallback only on Edge total failure), `fetchTodayRegularClose` (latest 16:00 ET close per ticker for the MC cards' "since 16:00 ET" anchor). `trimCnFundToRange` — the per-range trim that makes 1M / 3M / YTD actually differ for CN funds (both proxies return ~500 daily bars regardless) — is pure and pinned by `historical.test.js`. |
| `holdings_list.jsx` / `holdings_list.test.jsx` | The ☰-menu **Holding list** table. Pure `buildHoldingsRows(metrics)` flattens `metrics.positions[].players` into one row per holding (cash excluded; exposure = mv / total, costBasis = shares·cost·fx, unrl derived) and `sortHoldingsRows(rows, key, dir)` sorts; both pinned. `<HoldingsListModal>` renders the sortable table (default exposure desc) and calls `onTickerClick` to open the chart modal. Header has **copy** (TSV → clipboard) + **download** (`.xlsx`) icon buttons that export the table via `holdings_export.js`. `COMPANY_NAMES` is a static ticker→name map (no client name source for equities; unknown → "--"). |
| `holdings_export.js` / `holdings_export.test.js` | Pure, dependency-free export helpers for the Holding list. `holdingsRowsToMatrix(rows)` builds a 9-column string matrix (header + rows) formatted with the SAME `fmtMoney` / `fmtPct` the table renders; `matrixToTsv` joins it for the clipboard; `matrixToXlsx` packs a minimal valid OOXML workbook by hand (stored zip + CRC32, every cell an inline string) so no spreadsheet library lands in the bundle. |
| `icons.jsx` | Shared monochrome inline-SVG icons (`IconCopy`, `IconDownload`, `IconCheck`, `IconX`) for the header icon buttons — `currentColor` strokes so they pick up the chalk theme. Used by the Holding list export buttons and the chart-modal screenshot buttons. |
| `screenshot.js` / `screenshot.test.js` | Modal-screenshot helpers. `captureNodeToPng(node)` rasterises a DOM node to a PNG via a lazily `import()`-ed `html2canvas-pro` (separate chunk; oklch-aware). `copyNodeImage` writes an `image/png` ClipboardItem built around the still-pending capture (Safari-activation-safe); `saveNodeImage` routes to the Web Share sheet on a coarse pointer (→ photo album) and a file download on desktop, with a download fallback. |
| `screenshot_actions.jsx` / `screenshot_actions.test.jsx` | The chart modal's copy/save screenshot buttons. Finds its own `.modal` panel via `closest()`, tags the action group `screenshot-skip` so html2canvas omits the chrome, and gives copy transient ✓ / ✕ feedback. |
| `overnight_intraday.js` / `overnight_intraday.test.js` | Client read/cache layer for the server-side overnight recorder (the actual sampling is `overnight-record` on pg_cron). `fetchOvernightSeries(tickers)` hits `overnight-fetch`, mirrors the result to localStorage (`dp.overnight.cache`) + fires an `overnight:fetched` event; `getOvernightSeries(ticker)` is the synchronous cache read so the modal paints instantly; `mergeOvernightSeries(series, pts, ctx)` is the pure splice: it keeps Yahoo bars dated before the first recorded overnight point, then lets the recorded T212 5-min samples OWN the overnight window from there (only ext-on + overnight + overnight-session ticker + 1D/1W/1M + ≥2 in-window points; otherwise returns the series ref unchanged so the modal's single-heartbeat-dot path is the no-regression fallback). On 1W / 1M the merge step-samples the 5-min points to the range's bar cadence (`barIntervalMs` in ctx — 30 min / 60 min from `NIGHT_BAR_INTERVAL_MS`, → every 6th / 12th point), always appending the live tail so the line still ends at "now"; otherwise the ~130 overnight points would crowd today's index-axis on those views and visually swallow the multi-day trend (right ~50% / 25% of the chart). It deliberately does NOT cut at "the last Yahoo bar" — Yahoo now returns sparse overnight prints for the most liquid names (NVDA/ORCL) but not others (GOOG), which made the old `> lastBarDate` filter draw the line only for tickers Yahoo had no overnight data for. `app.jsx` warms the points as part of the page-entry + manual-Refresh preload wave (fired in parallel with the price/MC/chart fetches and `await`ed before `setLastUpdated`, so the cache is guaranteed hot by the time the user sees the refresh complete; also re-fired on every overnight auto-tick); `ticker_chart_modal.jsx` derives `displaySeries` from the merge, also fetches its own ticker on open as a backstop, suppresses the dot when the line is present, and keeps the rightmost point live. |
| `chart_modal_geometry.js` / `chart_modal_geometry.test.js` | Pure geometry for the ticker chart modal: anchorClose selection (regular / ext-mode fallback chain to lastPrice / prevClose / series[0]), `hasData` gate, `xOfIdx` / `yOf` scale fns, y-range containment for PE/PS 3yAvg + MA + VWAP + the overnight-dot price, "nice step" y-tick spacing, and index-spaced x-ticks (+ the "now" tick at the live dot's true-time x). Lifted out of `ticker_chart_modal.jsx` in PR #158 — the inline block had grown to ~200 lines that needed to be touched in 8 different positions during PR #157's SFTBY / `.PVT` saga. Pinned by 13 vitest cases. |
| `chart_geometry.js` / `chart_geometry.test.js` | Shared SVG-chart helpers used by both `perf_chart.jsx` and `ticker_chart_modal.jsx`. `pointerToDataIndex(event, svgEl, geom, dataLength)` replaces the duplicated 20-line `handleMove` math (mouse + touch coord extraction, SVG letterbox correction, axis-padding clamp, round-to-nearest-index) so a bug fix in one chart propagates to the other automatically; `geom.xDenom` optionally overrides the x denominator when the bars don't fill the full width (the modal's overnight view reserves the right edge for the live dot's time-proportional gap). `overnightTrailingGap(lastBarMs, nowMs, barIntervalMs)` returns how far past the last bar the live "night market" dot sits, in bar-interval units, so the otherwise index-based chart honours real elapsed time for just the current overnight session. `pointsToSvgPath` is also exported, plus `parseChartDateUTC` (append the missing `Z` to the 16-char intraday date so non-UTC users don't read every bar an hour early) and `findRegularCloseIdx` (the strict `closeHh:closeMm` backward walk for the regular-close anchor / CLOSE marker) — both lifted here from the byte-identical copies `perf_chart.jsx` + `ticker_chart_modal.jsx` had inline. vitest pins the letterbox math, the `xDenom` override + gap edge cases, the date parse, and the close-bar search. |
| `chart_store.js` | IndexedDB-backed chart cache layer built on [`idb-keyval`](https://github.com/jakearchibald/idb-keyval). Three logical stores — `ChartStore` (per-ticker per-range chart series + the `\|FUND\|v3` fundamentals row + the `\|PE\|v5\|...` series), `MaStore` (MA overlay wider-history per ticker × range), `YtdStore` (PerfChart's per-(year, range, ticker) entries). Each store has a synchronous in-memory `Map` mirror that's auto-hydrated from IDB at module load so the modal's `useState` initializer can read warm cache on the very first paint. Writes update the mirror immediately and persist to IDB in the background (best-effort). One-shot legacy-`localStorage` migration on first hydrate copies any existing `dp.tickerChart` / `dp.maCache` / `dp.ytd` rows into the matching IDB store, then deletes the localStorage row to free the quota for `dp.auth` / `dp.prefs`. Falls back to mem-only cleanly when `indexedDB` is undefined (vitest, private-mode iOS Safari). `pruneAllChartStores(maxAgeMs=30d)` evicts entries older than the horizon (delisted tickers, stale phase/variant permutations) — called once after the module-load hydrate and at the tail of every prefetch pass, so the three stores stay bounded across a long-lived session instead of growing without limit (the `pruneOlderThan` method existed but was never wired up before 2026-06). |
| `formatters.js` / `fx.js` / `metrics.js` / `lots.js` | The pure pieces lifted out of `utils.js`. `formatters.js`: `fmtMoney` / `fmtPct` / `fmtPrice` / `fmtShares` (share count, ≤2 decimals, no padded zeros) / `pctColor` / `maskDigits` / `formatAgo`. `fx.js`: `detectCurrency` / `currencySymbol` / `fxRateToUSD` (the version that returns `{ rate, missing }` so a 1:1 fallback can be surfaced) / `fxToUSD` (back-compat shim). `metrics.js`: `computeMetrics` / `detectFormation`. `lots.js`: `cleanLots` / `totalShares` / `weightedAvgCost` (lot-input sanitisation, which used to be inline in modals.jsx and silently kept negative cost values). All pinned by `utils.metrics.test.js` (19 cases) and `lots.test.js` (14 cases) so the on-screen portfolio numbers can't quietly regress. |
| `data.js` | `INITIAL_PORTFOLIO` seed for first-load demo state. |
| `ytd.js` | Pure chart math. `buildTickerSeries`, `computeAt` (sums per-lot value/basis; restricted to **board-scoped** holdings — only tickers referenced by a position, matching `computeMetrics` so an orphaned holding can't split the chart from the scoreboard; with `prevCloseBasis` — passed for 1D — every held lot's basis is forced to `prevClose` and no-prevClose holdings are counted FLAT in the denominator, so the 1D PerfChart right edge equals the scoreboard DAY CHANGE; cash is also added to both value and basis), `lotsFor`, `closeOn`, `RANGES`, `fetchParamsFor`, `maFetchParamsFor` (per-range wider-history params for the MA overlay; honours the `dailyOnly` override so CN funds / `.PVT` get 1d-only history), `filterToLatestDay`, `filterToLast24h`, `applyVariantFilter` (the 1D fetch-variant → display-window dispatch — `closed` → latest day, `reg`/`ext` → last 24 h — that `perf_chart.jsx` / `use_ticker_chart_data.js` / `prefetch.js` had inlined at 8 sites). Decoupled from React so it's unit-testable. |
| `ytd.test.js` | YTD formula pins (pre-year lot, year lot, mixed, missing janPrice, 1D ext mode anchored at today's regular close, intraday date comparison, etc.). |
| `utils.test.js` | `fetchHistoricalBatch` strategy pins: Edge fast path, "trust Edge omissions" (no proxy fallback when Edge succeeded with a partial response), Edge total-failure → proxy fallback, CN-fund proxy bypass, empty input, dedup. **Note**: the sibling `fetchYahoo` (live prices, not historical bars) takes the opposite stance — when the Edge Function returns a partial set it proxy-retries the omitted tickers, because Yahoo dropping a single FX pair for one tick was the actual root cause of the recurring `FX MISSING` flash (`fxRateToUSD` 1:1 fallback baked into the portfolio total until next refresh). Historical bars don't have that problem so the chart path stays cheap. |
| `ticker_class.js` / `ticker_class.test.js` | Pure regex predicates for ticker shape (`isCrypto`, `isFutures`, `isForex`, `isIndex`, `isExchangeListed`, `isCnFund`, `isPvt`, `isDailyOnly`, `isUsEquity`, `isEuroExchange`). `isEuroExchange` is the single source for the euro-zone exchange-suffix list (`.PA`/`.AS`/`.DE`/`.MI`/… — `fx.detectCurrency` reuses it for EUR detection, `computeMetrics` for the ext-hours gate). Lifted out of `ticker_chart_modal.jsx` / `prefetch.js` / `indicators.js` so the same classification can't drift between three callers (was happening — modal said `BRK-B` is crypto because its earlier regex was just `/-USD$/` instead of `/-USD$/i.test` AND a "doesn't start with `^`" check). Also exports `hasOvernightSession(ticker)` = `isUsEquity` minus an explicit `NO_OVERNIGHT_SESSION` set (currently `SFTBY`) — OTC ADRs that are US-shaped but quote only their regular session, so they're excluded from the night-market heartbeat dot + T212 overnight-price override that would otherwise show their stale close as a fake live quote. |
| `cache.js` / `cache.test.js` | Shared TTL constants (`RANGE_TTL_MS`, `MA_TTL_MS`, `PE_TTL_MS`) + freshness predicate (`isFresh(entry, ttlMs, extraValid?)` with a pluggable per-row check, e.g. `hasAnyNumericField('volume')` for 1D rows that pre-date the volume-bearing Edge Function deploy) + cache-key helper (`tickerChartCacheKey`, the single source of truth for the modal + prefetch). The PE key carries an algorithm-version suffix (currently `v4`) so a breaking change to the PE-series math (e.g. the 2026-05 ADR USD-anchor rescale) can evict every browser's cached series in one push by bumping the suffix, instead of waiting out the 12 h TTL. Soft LRU (`trimLru`) is still here but only used for legacy localStorage rows during migration — IDB-backed caches don't need it. |
| `indicators.js` / `indicators.test.js` | Pure indicator math lifted out of the chart modal: `maBarsFor` / `maLabelDaysFor` / `rollingSma` / `computeMaSeries` (MA overlay), `vwapSessionResetFor` / `vwapSessionKeyOf` / `computeVwap` (per-asset anchor + cumulative VWAP + forward-fill smoothing), `priceDividedByTtmEps` (TTM-history-aware ratio series — drives both P/E and P/S), `hasExtendedHoursBars` (the SFTBY/OTC bogus-extPrice detector), `extPriceIsRealAh` (the shared "is the upstream `extPrice` a real ext-hours trade, or a sentinel that should fall back to `lastPrice`?" verdict used by both the VIX-class MC cards and the drill modal so they can't disagree about which price to render). Every function takes plain arrays so it can be pinned by vitest without spinning up React — the modal was the single largest source of subtle math regressions in this codebase and every fix had been risking silently breaking another ticker class because the conditions were tangled with rendering state. |
| `header_sidebar.jsx` | `<Header>` (scoreboard + extended-hours toggle + hide-values eye), `<Sidebar>` (top movers + formation value + perf chart), `<MarketConditions>` (10 cards desktop, 9 cards mobile in a 3 × 3 grid; SOX dropped on mobile), `<UpcomingEarnings>` (next 3 future earnings dates across the user's holdings, sorted ascending, with BMO/AMC time hints). The clock + STALE pill live in their own leaf components (`HeaderTime`, `HeaderStatusPill`) so the parent Header doesn't re-render every second. The sidebar foot shows the `R · E · X` keyboard-shortcut hint on desktop (the keys don't fire on touch so the row is hidden on mobile) and a multi-source label (`Yahoo · Eastmoney · Finnhub · AV · T212`) reflecting every external provider the dashboard integrates. Re-exports `<PerfPanel>` from `perf_chart.jsx` so `app.jsx` keeps its existing import. |
| `perf_chart.jsx` | `<PerfChart>` (the chart) + `<PerfPanel>` (chrome wrapper). 5 ranges, dual fetch effect (S&P alone + portfolio batch in parallel), background prefetch effect for the other ranges, DOM-ref crosshair, CLOSE/OPEN markers in 1D, ^GSPC RTH filter + ES=F ETH filter. |
| `pitch.jsx` | Football-pitch SVG rendering. Position chips, captain armband, hot-mover ball, inline subtitle rename in edit mode. **Edit-mode drag-to-swap**: dragging one position chip onto another calls `onSwapPositions(keyA, keyB)` (app.jsx `swapPositions` — swaps `subtitle` + `tickers`, keeps `label`/`role`/slot). Implemented with **Pointer Events** (mouse + touch; HTML5 DnD never fires on touch) handled imperatively — direct `style.transform` + `classList` on the dragged / drop-target nodes so each pointermove doesn't re-render every chip; only the final swap goes through React. The dragged chip is `pointer-events:none` during the gesture so `document.elementFromPoint` resolves the chip underneath as the drop target; an 8px movement threshold separates a drag from a tap, and a `clickGuardRef` swallows the post-pointerup click so a swap doesn't also open the drill modal. |
| `heatmap.jsx` | One tile per holding, sized by market value, colored by day-change. |
| `modals.jsx` | `<PositionDrillModal>`, `<EditTickerModal>` (lot editor + **Move holding** — a two-step position picker next to Delete that relocates the ticker to another tactics-board slot via `onMove(toPosKey)`; targets exclude GK and the current slot), `<AddTickerModal>`, `<CashModal>`. Also exports `useConfirm()` → `{ confirm, element }`: a themed in-app replacement for `window.confirm` (the bare system dialog sat outside the dark theme and read like an OS error in the iOS PWA). `await confirm({ title, message, detail, confirmLabel, danger })` resolves true/false; the dialog portals to `<body>` so it stacks above the modal that raised it. Used for every destructive confirm — reset board, remove holding, discard-unsaved-changes on close / Move. Move-flow + the themed discard confirm pinned by `modals.test.jsx`. |
| `ticker_chart_modal.jsx` | Single-ticker price-history modal. PerfPanel's range buttons plus a modal-only **1Y** (trailing-12-month) price range after YTD, plus one optional valuation button — `P/E 1Y` for profitable stocks, `P/S 1Y` for loss-makers, mutually exclusive. Header row carries `Last $price · DAY %change` on price ranges, switches to `P/E ratio · 3Y AVG` or `P/S ratio · 3Y AVG` on the valuation buttons, and ends with a live `Mkt Cap $value` (recomputed every poll from `price × sharesOutstanding`, where `sharesOutstanding` comes server-side from `marketCap / price` rather than `defaultKeyStatistics.sharesOutstanding` so ADRs stay correct — Yahoo's "shares outstanding" field for ADRs reports the foreign parent-company share count, which would balloon T's market cap by orders of magnitude). A separate PEG line sits below the P/E row when applicable. Holdings get a `Shares · AC · Cost · Value(%) · G/L` line. Overlays: gray `MA 5 / 10 / 20 / 50 / 200` on 1W / 1M / 3M / YTD / 1Y respectively (the 1Y view draws a **200-day** MA, fed by a 2y wider fetch so the window is full to the left edge; bar-based SMA on a same-interval wider fetch held in `dp.maCache`, with the display series merged in so the line spans the full chart even when the cache drifts); gray `VWAP` on 1D for tickers Yahoo gives per-bar volume for (US equity reset 09:30 ET / pre-market 04:00 ET when ext is on; crypto reset 00:00 UTC; forward-fill smoothing for sparse-volume tickers like BTC-USD). DOM-ref crosshair (no React rerender on hover), persistent IndexedDB cache + stale-while-revalidate, 6-digit CN funds and `.PVT` private holdings restricted to 1M / 3M / YTD / 1Y. **Overnight live dot**: for a US equity with an overnight session held in T212 (`hasOvernightSession` — OTC ADRs like SFTBY are excluded so they don't show a stale close as a fake heartbeat), during the overnight session (20:00–04:00 ET) with the Extended Hours toggle on, the broker's `currentPrice` (carried on `holding.extPrice`) renders as a single UNCONNECTED pulsing heartbeat dot at the far-right of the 1D / 1W / 1M chart — Yahoo has no overnight bars, so the historical line stays real and the x-axis reserves a gap proportional to elapsed overnight time (`chart_geometry.overnightTrailingGap`) so the dot floats at its true-time position. While the dot is shown the static end-of-line dot is suppressed (avoids a double marker); the crosshair can snap onto the dot (`geom.hasLiveDot` makes `pointerToDataIndex` return the live point in the dot-half of the gap) and reads its price + current time; a rightmost x-axis tick labels the dot with the live time; and the VWAP / MA overlay labels move from the far-right margin to the line's end so they don't float across the gap. Gated so regular / pre-market / after-hours and non-US tickers are byte-for-byte unchanged. P/E view divides the trailing-1Y daily price series by historical TTM EPS from Yahoo's `fundamentals-timeseries` so the curve steps on earnings dates; P/S view divides by a TTM sales-per-share history rolled from Yahoo's `quarterlyTotalRevenue` (4-quarter sum via `rollingTtmFromRawQuarterly`, rescaled to USD via `normalizeEpsHistoryToUsd`), falling back to const current sales-per-share when no quarterly history is published. Both ratio views derive their per-share denominator from `lastClose / ratio` so the chart stays USD-correct for ADRs regardless of whether the upstream returned EPS / revenue in the foreign reporting currency. Both the bar fetch and the fundamentals fetch retry 3× with 250 ms / 500 ms backoff before reporting `fetch.histsingle` / `fetch.pe.network-drop` to ops-error, so a single transient Yahoo burp doesn't flip the modal into the red "Couldn't load history" state. When no usable ratio exists in either flavour (very-recent IPOs etc.) the modal renders the soft "P/E not available — N/A" panel instead of an error. Indicator math (MA, VWAP, PE-from-TTM-history, extended-hours-bar detection, `extPriceIsRealAh` ext-trade verdict) lives in `indicators.js` so it can be pinned by tests; ticker shape predicates come from `ticker_class.js`; cache helpers from `cache.js`; the pure constant maps + `fmtTickerPrice` / `modalTtl` / `modalCache` get/set live in `ticker_chart_helpers.js`; and the data layer — all six fetch effects + their state — lives in two `renderHook`-tested hooks, `use_ticker_fundamentals.js` (valuation metadata) + `use_ticker_chart_data.js` (price series), so the component itself is now geometry + render. |
| `ticker_chart_helpers.js` / `ticker_chart_helpers.test.js` | Pure module-scope helpers carved out of the modal: `SYMBOL_BY_CUR`, `NIGHT_BAR_INTERVAL_MS`, `TICKER_DISPLAY_NAMES`, `INDEX_PE_ALLOWED`, `fmtTickerPrice` (per-ticker price formatter — `%` for `^TNX`, 4dp for FX, no prefix for indices/futures, currency-prefixed for equities), `modalTtl`, and the `modalCacheGet`/`modalCacheSet` ChartStore wrappers. Pinned independently of React. |
| `use_ticker_fundamentals.js` / `.test.jsx` | `useTickerFundamentals(ticker, supportsPePattern)` — the modal's valuation-metadata data layer: the synchronous `\|FUND\|v3` cache seed + the background fundamentals fetch + write-back, returning `{ peSupported, psSupported, pe3yAvg, ps3yAvg, peg, sharesOut }` (which feed the modal's `visibleRangeKeys` + header). `renderHook`-tested. |
| `use_ticker_chart_data.js` / `.test.jsx` | `useTickerChartData({...})` — the modal's price-series data layer: the five fetch effects (main range fetch incl. the PE/PS TTM transform, MA-overlay history, background other-range prefetch, 1D live-poll, overnight recorded-points) + their state, returning `{ series, loading, error, noPe, maHistory, overnightPts }`. This is the block that fixed bug after bug (overnight race, ext anchor, prefetch coverage, PE/PS window); pulling it out of the 1400-line component into a `renderHook`-tested hook is what keeps it from being a moving target. The modal consumes the two hooks and keeps the geometry + render. |
| `sw-banner.jsx` | "New version available — RELOAD" banner. Uses `useRegisterSW` from `vite-plugin-pwa`. Polls for new versions every 60 s (was 10 min) AND on `visibilitychange` / `focus` so a backgrounded PWA picks up the banner the moment the user opens it. Kicks `updateServiceWorker(true)` for the standard `controllerchange`-driven reload, with a hard `window.location.reload()` fallback because iOS Safari (and standalone-PWA Chrome) don't fire `controllerchange` reliably. The fallback timer is armed UP FRONT (not after the cleanup `await`s): the reload used to sit at the end of the purge chain, so a single wedged step — a blocked `indexedDB.deleteDatabase` whose `onblocked` never resolves — stranded it and the button stuck on "RELOADING…" forever. Now a hard timer owns the reload and the purge (`purgeForReload`, extracted + pinned) merely races it: reload fires at whichever lands first, a finished purge or the 1.5 s deadline. The purge nukes everything except sessionStorage — Workbox caches, every registered SW, `localStorage`, IndexedDB — for a first-open clean slate; the auth token survives in sessionStorage (persists across reload-in-tab). |
| `ops_error.js` / `ops_error_badge.jsx` | `reportError(kind, opts)` POSTs failures to the `ops-error` Edge Function (per-`(kind, symbol)` cooldown + per-load cap, `keepalive: true` so render-crash reports survive a Reload). `fetchOpsErrorSummary(hours)` reads the same function's `?action=summary` endpoint with the admin `x-app-token` header attached so admin viewers can pull the last-24 h aggregate without hitting Supabase directly. **What we report**: `auth.unexpected` / `auth.network` (auth failures), `render.crash` (React error boundary), `fetch.histsingle` (chart fetch ran out of retries), `fetch.perfchart.anchor` (PerfChart anchor missing), `fetch.pe.network-drop` (fundamentals Edge Function returned no row at all for a ticker — real backend incident). **What we deliberately don't report**: `fx-fallback` (FX MISSING pill already shows it interactively); the "ticker has no positive trailing P/E" case (loss-makers like NBIS — legitimate financial state, not a bug); `data.save.conflict` (a 412 optimistic-concurrency reply is the normal self-healing multi-tab/device outcome — the conflict banner + next auto-refresh fetch the latest, not a backend incident); and `sw.activation.timeout` (dropped — iOS Safari / standalone-PWA Chrome fire `controllerchange` unreliably even on a healthy RELOAD, so the report was pure noise for a path that self-heals via the hard reload that runs regardless). The `OpsErrorBadge` component (desktop-gated, see Highlights) is the in-app surface for the summary; the same endpoint is still queryable directly when finer triage is needed. |
| `prefetch.js` | `prefetchAllChartData(opts)`. Fired from `doRefresh` on initial load + manual Refresh click (skipped on the 30 s auto-refresh tick). Walks every (range × ticker) combo, skips ranges that are fully fresh under their TTL (and treats 1D rows missing the new `volume` field as stale so the VWAP overlay shows up after the Edge Function redeploy without a manual cache wipe), and writes results into the PerfChart cache (`dp.ytd`), the TickerChartModal cache (`dp.tickerChart`), and the MA overlay's wider-history cache (`dp.maCache`) so the next chart open is instant. The range walk includes the modal-only **1Y** range, so `${ticker}\|1Y` is warm on first modal open and — critically — the **same** trailing-1Y price series feeds the P/E / P/S precompute below, so the app-prefetched ratio series can't disagree with the modal's own fetch. Also fetches each eligible ticker's full fundamentals row (`{eps, pe, pe3yAvg, ttmEpsHistory}`) — cached under `${ticker}\|FUND\|v3` so the modal's P/E-button visibility can be decided synchronously on first paint, and the `${ticker}\|PE\|v5\|...` series is precomputed via `priceDividedByTtmEps` (over the 1Y series) so clicking P/E 1Y hits cache instantly instead of waiting on a fresh fundamentals fetch. **The PE/PS algorithm-version suffixes step on breaking changes** (P/E `v4→v5`, P/S `v2→v3` were the YTD→trailing-1Y price-window switch; earlier bumps evicted the broken-anchor ADR peSeries rows) — `PE_TTL_MS = 12 h` plus the prefetch's `fundFresh && ratioFresh` skip gate means any browser holding a stale-shape series would otherwise stay stuck on it until the TTL elapsed, so bumping the suffix is the standard cache-busting move. Uses the shared `cache.js` (`isFresh` / `hasAnyNumericField` / `trimLru`) and `ticker_class.js` (`isDailyOnly`) helpers so the prefetch + modal can't disagree on freshness or daily-only routing. |
| `trading212.js` / `trading212.test.js` | `fetchTrading212Holdings()` hits the `trading212` Edge Function and returns `{ holdings: { 'VUAA.L': { shares, cost }, … }, prices: { 'VUAA.L': 98.4, 'AAPL': 234.5, … } }` or null; `applyTrading212(holdings, t212, today)` overlays the shares/cost allow-list on the live portfolio by replacing each matching ticker's `lots` with a single synthetic lot dated today, while `applyTrading212NightPrice(holdings, prices, active)` overlays the `prices` map as overnight quotes (only tickers with `hasOvernightSession` — US equities excluding OTC ADRs like SFTBY — and only when `active`). Fired in parallel with the live-prices / MC / ext-series fetches inside `doRefresh`. Best-effort: a null T212 response leaves the lots alone, so a transient upstream error doesn't wipe what the user last saved manually. The user can still edit lots in EditTickerModal; the next auto-refresh tick just overwrites the manual edit with whatever T212 reports. |
| `types.d.ts` | JSDoc-friendly type definitions. |
| `styles.css` | All app styles (single sheet). |
| `test_setup.js` | Single-line vitest setup file (referenced from `vite.config.js → test.setupFiles`). Imports `@testing-library/jest-dom/vitest` so `toBeInTheDocument` / `toHaveTextContent` etc. work in every test without a per-file import. |
| `ticker_chart_modal.test.jsx` / `perf_chart.test.jsx` / `app.test.jsx` | Component-level smoke tests (React-Testing-Library on top of vitest's `jsdom` env). Each one mounts the component with heavy children + network calls mocked via `vi.mock` and asserts the render-decision tree (loading / error / has-data branches) hasn't drifted. Bar is "regression coverage for prop renames + hook reorders", not E2E — the math is still pinned by the pure-helper tests. |
| `index.html` | Vite root. References `/assets/index-<hash>.js`. |

### `supabase/functions/` — Edge Functions (Deno)

| Function | What it does |
|---|---|
| `auth` | `POST { password }` → `{ token, role }` on success, `429 { lockoutUntil }` after 3 wrong attempts from the same IP. Lockout window **doubles each repeat** (24 h → 48 h → 96 h ... capped at 30 days, per migration `0011`) so a brute-forcer can't grind 3-tries-per-day forever. Per-IP key uses the LAST entry of `x-forwarded-for` (not the first, which the client can spoof). Wrong-password responses are also held for 500 ms server-side as a secondary throttle. Tokens are `<base64url(payload)>.<base64url(sig)>` where payload is `{ role, exp }`, signed HMAC-SHA256 with `APP_AUTH_SECRET`; signature comparison is constant-time across all functions that verify it. |
| `data` | `?action=load` / `?action=save`. Validates the `X-App-Token` header (re-derives HMAC + checks exp + checks role) before reading / writing `board_data`. Service-role key never leaves the function. **Optimistic concurrency** (per migration 0013): load returns `{ data, version }`; save forwards the client's `If-Match` header into the `save_board_data` RPC, which performs an atomic version-check + UPSERT and returns 412 `{ error: 'conflict', currentVersion }` when the version doesn't match. Missing `If-Match` falls through to the legacy unconditional write (backward compat for old bundles + one-off scripts). The 42P01 / 42883 detection on RPC failures logs "re-apply migration 0013" so a fresh project missing the migration is obvious from the function log instead of silently degrading to last-write-wins. |
| `prices` | `?tickers=NVDA,017731,GBPUSD=X,…` → `{ ticker: { lastPrice, extPrice?, prevClose, currency, dayPct, extDayPct? } }`. Routes 6-digit codes to eastmoney's `fundgz.1234567.com.cn`, everything else to Yahoo Finance v8. Non-US tickers (any dotted-suffix symbol — `.L`, `.HK`, `.SS`, …) explicitly skip the ext-hours candle scan since they don't have a US-style pre/post session; `extPrice` stays null. All outbound calls wrapped in `AbortSignal.timeout` so a hung upstream can't pin the function for 60 s. |
| `chart` | `?tickers=…&range=1mo&interval=60m&includePrePost=true` → `{ ticker: [{ date, close, volume? }, …] }`. Intraday bars also carry the per-bar `volume` (used by the modal's VWAP overlay). Routes CN funds to a 3-tier eastmoney fallback (pingzhongdata → lsjz JSON → danjuanapp), everything else to Yahoo. `.PVT` placeholders fall back to the bare symbol when Yahoo 404s the literal. |
| `fundamentals` | `?tickers=NVDA,NBIS,^GSPC,…` → `{ NVDA: { pe, eps, pe3yAvg, ps, ps3yAvg, peg?, sharesOutstanding?, ttmEpsHistory?, ttmSalesHistory? }, NBIS: { pe:0, eps:0, ps, ps3yAvg, … }, ^GSPC: { pe, eps:0, pe3yAvg }, … }`. Powers the ticker-modal P/E 1Y AND P/S 1Y views AND the live `Mkt Cap` line in the modal header. **Individual stocks**: Yahoo `quoteSummary` is the primary source (`trailingPE` / `trailingEps` / `priceToSalesTrailing12Months` / `forwardPE` / `earningsTrend` / `marketCap` / `price`, all USD-correct for ADRs), with Finnhub `/stock/metric` as the whole-row fallback when Yahoo's crumb handshake fails or it's rate-limited. quoteSummary now 401s anon callers, so `getYahooCrumb()` does the cookie → `/v1/test/getcrumb` → `&crumb=…` handshake once per Edge Function worker and caches the pair in module scope (single-flight guarded so the 6 parallel stock workers don't each handshake). FMP was the primary source through the ADR-currency-fix saga, but it retired its `/v3/` endpoints for post-2025-08-31 keys (403 "Legacy Endpoint") and paywalled the `/stable/` replacements (402), so the whole FMP layer was removed — Finnhub's `peTTM` divides the USD ADR price by the foreign-currency reported EPS (TSM ≈ 1.22 / SFTBY ≈ 0.07 / ASML ≈ 63 — the bug the saga was about), Yahoo's quoteSummary ratios aren't affected. Finnhub still runs in parallel on the happy path to source `pe3yAvg` / `ps3yAvg` from `series.annual.pe` / `series.annual.ps`, since Yahoo doesn't expose historical-annual ratios. The pe/eps/ps validation is relaxed to "any usable ratio surfaces the row" so loss-makers (eps ≤ 0 → no pe) still come back with a ps value for the P/S 1Y view. **PEG** = `computePeg(forwardPE, computeForwardGrowth(earningsTrend.trend))` — forward-over-forward; the growth denominator is the **blended 2y forward EPS growth**, computed by averaging the `0y` and `+1y` bucket `growth.raw` rates from Yahoo's `earningsTrend.trend` and dropping non-positive buckets. Yahoo retired its `+5y` long-term-growth bucket in May 2026, so the two near-term annual buckets are the only free forward CAGRs left; averaging them is steadier than any single fiscal year for cyclical tech / semi names. Returns null when either forward P/E or blended growth is missing or growth ≤ 0. **`sharesOutstanding`** is derived server-side as `marketCap / regularMarketPrice` rather than read from `defaultKeyStatistics.sharesOutstanding` — Yahoo's "shares outstanding" field for ADRs reports the foreign parent-company share count, which would balloon TSM/SFTBY/ASML market caps by orders of magnitude when the client multiplies it by the USD ADR price. The client uses this to recompute the live `Mkt Cap` line every poll (`livePrice × sharesOutstanding`). **Four big US indices** (`^GSPC`/`^NDX`/`^RUT`/`^SOX`) → Alpha Vantage `OVERVIEW` against ETF proxies (SPY/QQQ/IWM/SOXX) cached for 24 h in `index_fundamentals_cache`; 3Y-avg P/E lives in `INDEX_PE_3Y_AVG` constants. Hardcoded `INDEX_PE_FALLBACK` constants kick in if AV is unreachable. **Opt-in `&ttmEpsHistory=true`** adds a `ttmEpsHistory: [{date, eps}, …]` array sourced from Yahoo's `fundamentals-timeseries` (`trailingDilutedEPS`, 5+ years of pre-summed quarter-end TTM EPS), falling back to a Finnhub `/stock/earnings` sum-of-4-quarters if Yahoo misses. **`&ttmSalesHistory=true`** adds the parallel `ttmSalesHistory: [{date, eps}, …]` array for the P/S 1Y view, but built differently: Yahoo's `trailingTotalRevenue` endpoint only ships 2 stale annual points per ticker (confirmed in the May-2026 prod probe), so the function pulls `quarterlyTotalRevenue` and runs `rollingTtmFromRawQuarterly` to sum every 4 consecutive quarters into a TTM series before rescaling to per-share. For ADRs the upstream EPS / revenue histories are reported in the underlying foreign currency, so the Edge Function rescales each to USD via **`normalizeEpsHistoryToUsd(history, usdAnchor)`** before returning. The `usdAnchor` is Yahoo quoteSummary `price/pe` → Yahoo `/v8/finance/chart` `meta.regularMarketPrice ÷ pe` (the no-crumb endpoint, what Yahoo's consumer site uses); for the sales history the anchor is `usdPrice / ps` so the latest entry lines up with `lastClose / ps`. When the ratio (anchor / latest history entry) lands within ±20 % the function returns the history untouched (it's already in USD), so US-listed stocks pay no rescaling cost. Index rows return `eps:0` and the client reconstructs an implied EPS from `lastClose / pe`. |
| `ops-error` | Two modes, both admin-gated. `POST { kind, symbol?, message?, context? }` with header `x-app-token: <admin token>` → inserts into `ops_errors` (size + length capped; per-row IP captured server-side via the shared `_shared/ip.ts` extraction — `x-real-ip`, then the LAST `x-forwarded-for` entry, same trust order as `auth`'s lockout key). `GET ?action=summary&hours=24` with the same header → `{ hours, total, byKind, bySymbol }` aggregate over the last N hours, so triage doesn't require a Supabase dashboard login. POST was anon-writeable until 2026-05; the client-side per-(kind, symbol) cooldown + 50-per-load cap was trivially bypassable with random kinds, so the admin token gate now mirrors the summary endpoint's existing one. Trade-off: pre-auth render crashes that fire before the user's pwd → token round-trip completes are no longer captured. **Server-side reports**: the other Edge Functions (`auth` / `data` / `prices` / `chart` / `fundamentals` / `trading212`) wrap their top-level `Deno.serve` handler in a `try/catch` that writes a `<fn>.unhandled` row directly via the service-role key when an exception escapes — bypassing this function (and its token gate, since neither side of an Edge-to-Edge call has a user token) but going through the same `ops_errors` table so the admin badge surfaces it. Without that wrap an upstream crash returned a silent 500 only the browser console / Supabase logs saw. |
| `trading212` | `GET /functions/v1/trading212` → `{ holdings: { 'VUAA.L': { shares, cost }, 'SAEM.L': { ... } }, prices: { 'VUAA.L': 98.4, 'AAPL': 234.5, … }, updatedAt, source: 'cache' \| 'live' \| 'stale' \| 'disabled' }`. Two maps with different jobs. **`holdings`** is the auto-sync allow-list (VUAA.L / SAEM.L, the two USD-denominated UCITS ETFs the user DCAs into via T212's cashback + Spare-Change auto-invest — both settle USD, which is why the GBP-denominated VUAG.L / SEGM.L were swapped out; auto-invest in USD against GBP ETFs added an FX-haircut per micro-buy). Only these get shares/cost mirrored: `averagePricePaid` taken as **per-share USD AC** (settle currency, not GBp/pence), folded client-side into a single synthetic lot. **`prices`** is `currentPrice` (USD) for EVERY recognised T212 holding via a generic ticker map (`AAPL_US_EQ → AAPL`, `VUAAl_EQ → VUAA.L`), no extra API call — it comes in the same `/equity/positions` row. **Renamed / merged tickers** need a `T212_US_ALIASES` table on top of the generic rule: T212 assigns an instrument's internal code at first listing and never rewrites it through a rename / SPAC merger, so the API still returns `FB_US_EQ` for Meta, `YNDX_US_EQ` for Nebius, `IIVI_US_EQ` for Coherent, `VACQ_US_EQ` for Rocket Lab, `LOKB_US_EQ` for Navitas, and `GOOGL_US_EQ` for Alphabet — the generic rule would map those to the stale symbol (FB/YNDX/…) which never matches the board, so the overnight price silently never landed (the bug for META/NBIS/COHR/RKLB/NVTS/GOOG). The alias table maps each stale code → the current Yahoo ticker; it's price-map only and does NOT add them to the shares/cost allow-list. The client (`trading212.js` → `applyTrading212NightPrice`) uses `prices` ONLY as an **overnight ("night market") quote**: during the 20:00–04:00 ET overnight window (`usMarketPhase() === 'overnight'`) with the Extended Hours toggle on, for any **US equity** the user also holds in T212 it swaps T212's price into `extPrice` (+ `extPriceTrusted`, `extDayPct` vs the RTH close) so metrics shows the broker's overnight print. Regular / pre-market / after-hours keep the original Yahoo logic untouched; the LSE ETFs (not US equities), OTC ADRs with no overnight session (e.g. SFTBY, gated client-side by `hasOvernightSession`), and any T212 stock not on the board are skipped, so HOOD (held on Robinhood, never in the T212 response) is unaffected. Calls `https://live.trading212.com/api/v0/equity/positions` (the current endpoint; it nests the ticker under an `instrument` object and names the cost field `averagePricePaid` — `shapeT212Portfolio` also reads the legacy flat `ticker` + `averagePrice` shape) with one of two auth schemes. T212's documented public API takes the API key as the raw `Authorization` header value (no `Bearer ` prefix; see [t212public-api-docs.redoc.ly](https://t212public-api-docs.redoc.ly/)), but two-key accounts authenticate with HTTP Basic (`base64(key:secret)`). `T212_API_KEY` is required; `T212_API_SECRET` is optional. **When a secret is set the function goes straight to Basic** and only falls back to the raw key on a 401 — these accounts 401 the raw-key attempt, so trying raw first burned a doomed round-trip AND fired a second request inside the same second, risking T212's 1-req/s limit (a 429 on the real call). Without a secret it's raw-key only. Both keys are Supabase secrets, never in the client bundle. **Two accounts**: T212 scopes its public API per account, so the ISA account's holdings + their live overnight prices need their own key — set `T212_ISA_API_KEY` (+ optional `T212_ISA_API_SECRET`) and the function fetches both portfolios in parallel and merges them via `mergeShaped` (prices union'd; allow-list shares/cost summed for any ticker held in both). Invest is primary; an ISA fetch failure degrades to invest-only. Without an ISA stock's price in the merged map the client falls back to Yahoo's stale after-hours close for that ticker's overnight dot — the bug this closes. `cost` is **per-share AC**, matching the convention `lot.cost` / `h.cost` use elsewhere (computeMetrics multiplies by `shares` for total cost). Client-side, `fx.js` keeps a `TICKER_CURRENCY_OVERRIDES` map pinning `VUAA.L`/`SAEM.L` → USD, because the default `.L` → GBP suffix rule in `detectCurrency` would otherwise mis-convert their USD prices by the GBPUSD rate (~1.27×). **Server-side 1 s cache** in `trading212_cache`. An **atomic Postgres claim** (`try_claim_t212_refresh` RPC in migration `0008`, a conditional UPSERT that bumps `updated_at` only when the row is older than the TTL and returns whether it actually wrote) guarantees at most ONE upstream T212 call per second across every device — within T212's 1-req-per-second limit on `/equity/positions`. The 1 s TTL replaced the old 30 s / 120 s windows once the endpoint moved off the harder-limited `/equity/portfolio`: a 1 s floor keeps manual refreshes feeling instant (a click lands fresh data unless the last upstream call was under a second ago) while staying inside the rate limit. The cached `data` is `{ holdings, prices }`; `unpackCache` treats a legacy holdings-map row as `{ holdings, prices: {} }` so a deploy doesn't blank the response before the first live refresh. Only the claim winner calls T212; losers re-read the cache. Stale-tolerant for 5 min on T212 errors. **Token-gated**: requires the same HMAC-signed `x-app-token` the `data` / `ops-error` functions use — both admin and ro tokens accepted but anonymous callers get 401. Holdings are PII; an open endpoint would leak the owner's share counts and cost basis. Returns `source: 'disabled'` + empty maps when `T212_API_KEY` is absent so the function deploys safely before the secret is configured. |
| `overnight-record` | `POST /functions/v1/overnight-record` — **cron-triggered** (pg_cron every 5 min across UTC 0–9; see migration `0016`), NOT user-facing. Fetches T212 `/equity/positions` once and upserts every US-equity holding's `currentPrice` into `overnight_intraday_points` keyed by `(ticker, 5-min bucket)`. Internally gated on the overnight window (20:00–04:00 ET) AND not the weekend dead zone (Fri 20:00 → Sun 20:00 ET), both via `America/New_York` `Intl` (DST-safe), so the all-window cron firing is harmless off-hours (each spurious call records nothing). Reuses the trading212 ticker mapping (incl. the rename-alias table) + Basic-first auth + the ISA second account; excludes SFTBY (`hasOvernightSession`). **Auth: bearer `CRON_SECRET`** — and because that's not a Supabase JWT, this function deploys with `--no-verify-jwt` (in `PUBLIC_FNS`); otherwise the platform's JWT gate 401s the cron before our check runs. Pure helpers (bucket floor, overnight/weekend gates, ticker map, price extraction) pinned by `index.test.ts`. |
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
function's top-level catch uses.

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
| `0016_overnight_cron.sql` | pg_cron schedule for `overnight-record` (every 5 min, UTC 0–9, covers 20:00–04:00 ET in both DST regimes) + a daily 10:00 UTC prune keeping 30 days. The cron posts `Authorization: Bearer <app.cron_secret>`; **requires** `pg_cron` + `pg_net` enabled and `app.cron_secret` set to match the `overnight-record` function's `CRON_SECRET`. (Where `ALTER DATABASE … SET app.cron_secret` is permission-denied on Supabase, inline the secret directly in the `cron.schedule` body instead.) |
| `0017_revoke_bump_auth_attempt_from_public.sql` | `revoke all on function bump_auth_attempt(...) from public` (+ re-grant `service_role`). `0001`/`0011` granted `service_role` but never revoked PUBLIC, so PostgreSQL's default PUBLIC EXECUTE left the auth-lockout RPC callable by the anon/authenticated PostgREST roles with an arbitrary `_ip` (a targeted-lockout vector). Brings it to parity with the three cache/data RPCs that already revoke PUBLIC. Apply via Supabase SQL Editor. |

### Build / config

| File | What it does |
|---|---|
| `vite.config.js` | React plugin, PWA plugin (Workbox precache + runtime caches for fonts), build output to repo root. Bundle filenames pinned to lower-case hex hashes with an explicit `app-` prefix (`assets/app-{hex}.js`) so the URL can never contain a substring like `Ad`/`Ads` that AdGuard's content filter strips — caught one production outage where a build hash of `_Ad` made AdGuard's system-level proxy delete the `<script>` tag, blank-page-ing the site for users who had AdGuard. Hex (0-9a-f) is alphabet-safe against that whole class of false positive. |
| `tsconfig.json` | `checkJs: true` so JSDoc annotations get type-checked by `tsc --noEmit`. `strictNullChecks` is **on** — the `useState(null)` / `useRef(null)` slots carry JSDoc `@type` annotations so the null/undefined-bug class is caught; the rest of `strict` stays off until more files are annotated. |
| `eslint.config.js` | Flat ESLint config (ESLint 10). Deliberately a **bug** gate, not a formatting one: errors on `react-hooks/rules-of-hooks` (the hook-ordering class that shipped a React-#310 crash once) + `js.recommended` (with `allowEmptyCatch` for the codebase's best-effort-swallow pattern); `react-hooks/exhaustive-deps` is a non-blocking warning since a few effects intentionally narrow their dep set (documented inline). Stylistic / unused-locals are left to `tsc` + `knip`. `npm run lint`. |
| `_headers` | Cloudflare Pages cache rules **plus** the production security headers — Content-Security-Policy (scoped to the exact upstream origins the app talks to: Supabase, Yahoo, Eastmoney, Danjuanapp, Xueqiu, and the five public CORS proxies), Strict-Transport-Security (2-year preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geolocation/payment. `index.html` / `sw.js` always revalidate; `/assets/*` cached for a year (filenames are content-hashed). Source-of-truth lives at `public/_headers`; Vite copies it to the repo root on build. |
| `manifest.webmanifest` | PWA install metadata (name, icons, theme color). |
| `.github/workflows/check.yml` | CI: typecheck → lint → vitest → build → size-limit → knip → dependency audit, all hard gates, on every push + PR. |
| `.github/workflows/edge-functions.yml` | Edge Function CI/CD. Runs `deno test supabase/functions/` on every PR; on push to `main` it also deploys every changed `supabase/functions/<name>/index.ts` via the Supabase CLI (requires `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` repo secrets). Replaces the manual paste-into-dashboard workflow that CLAUDE.md still mentions — once those secrets are set the workflow takes over and the dashboard step is optional. |
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
npm test              # vitest (~399 client-side cases — YTD math + the applyVariantFilter window dispatch, indicators (incl. isPriceAxis live-tail gate + extPriceIsRealAh ext-trade verdict), cache + ratio-suffix key pins, ticker shape, fetch strategy + the CN-fund trimCnFundToRange, portfolio metrics + FX, lot sanitisation, market-cache + legacy fallback + the storage migrate/load/save pins, SW banner suppression window, ops-badge desktop gate, portfolio fingerprint diffing, fmtMoney magnitude tiers, applyTrading212 lots-merge, the shared chart geometry incl. parseChartDateUTC + findRegularCloseIdx). Plus the `fundamentals` Edge Function helpers (TTM rollover, USD-anchor rescale, pickPsFields ADR guard, computeForwardGrowth blend, computePeg) and the `trading212` helpers (T212 → portfolio shape incl. the `/equity/positions` nested-`instrument` shape, ticker mapping, two-account `mergeShaped`, cache TTL, basic-auth + token verify) on the Deno side.
npm run typecheck     # tsc --noEmit with checkJs + strictNullChecks
npm run lint          # ESLint (react-hooks bug rules; warns on intentional dep-array narrows)
npm run build         # production bundle to repo root
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
- Build output directory: `/`

This repo commits its built output (`assets/`, `index.html`, `sw.js` — see
`.gitignore`'s note and `wrangler.jsonc`'s `assets.directory: "."`), so
Cloudflare serves the repo root **as-is** with no build step. You run
`npm run build` locally and commit the result before pushing (CI's bundle
check, below, fails the build if you forget). Don't set a CF build command
— if CF rebuilt on its own it would produce a third, possibly-divergent
copy of the bundle.

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
