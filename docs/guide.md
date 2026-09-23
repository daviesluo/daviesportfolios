# Using the board

How each part of the site works, for someone looking at it for the first
time. The short tour is the [README](../README.md); the file-by-file map
is [map.md](map.md).

## Sign in

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

## Header / scoreboard

- **Time + market phase** — local UK time (auto-flips between BST
  and GMT) plus a coloured dot for the current US market phase
  (green = open, gold = pre-market, purple = after-hours, blue =
  overnight).
- **Extended hours toggle** — when off, the scoreboard reflects the
  regular session. When on, indices switch to their futures
  contracts (`^GSPC` → `ES=F`, etc.) and the day-change recomputes
  against today's regular close so post-market moves show up.
- **Hide-values eye** — masks every digit of money, prices and share
  counts with `•` so the page is screenshot-safe; percentages stay
  visible. Sticky across reloads.
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

## Tactics board view

- Each card shows a position (GK / CB / CDM / CM / LW / ST / RW …)
  with the holdings assigned to it. The card holding the single
  largest holding (by USD value) wears the captain's armband; the ball
  sits by the holding with the biggest displayed day move (the
  extended-hours move while that toggle is on).
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

## Heatmap view

- One tile per non-cash holding, sized by USD market value, coloured
  by today's % change (green up, red down, deeper = larger move).
- **Tap a tile** → opens the same ticker chart modal.

## Holding list + Sectors list + Transaction history + Agents (☰ menu)

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
  Its columns are Type · Date · Symbol · Shares · Price · Amount (in the
  holding's native currency) · Avg Cost · Realised G/L; a headline **total Realized G/L (USD)** sums
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
  its percentage beside it in the "+$1,234 (+0.56%)" style — over one line
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
  capital) and NEXT (the countdown to the bar close, "2h 13m"), split
  under two headings, LIVE STRATEGIES and TESTING STRATEGIES; on a phone
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
  recessive gridlines on one y axis, UK-local times under it (the clock
  the site's header shows), and a crosshair + tooltip (time, close, any
  fill under the cursor). Two mark kinds means a legend, so the row under
  the chart names them in words. Under the chart sits the **ORDERS**
  table for that pair — When · Symbol · Venue · Side (the same arrow as
  the chart's mark) · Price · Size · Cost · State · Fill · Fee · Mode —
  every order on the pair, newest first, priced by its fill where there is
  one, with a "Load full history" button. No description paragraphs, no
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

## Ticker chart modal

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
  loaded only on click — out of the main bundle (the 122 KB gate untouched)
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

## Performance panel — two charts, one slot

The panel header is two tabs, `VS S&P 500` (it reads `VS S&P FUT` while the
benchmark is the futures contract) and `INVESTMENT`. They switch between
two views of the same window; the range carries across, because the user
is looking at one window and asking two questions about it.

**Both views run the identical pipeline** — the same fetch, the same
grid, the same `computeAt` call. Only the drawing differs. That is
structural, not incidental: the Investment view's Value line *is* the
vs-S&P view's portfolio series, expressed in dollars instead of a
percentage, so the two panels cannot report different numbers for the
same book on the same day. An earlier attempt gave the second chart its
own reconstruction of the portfolio; the two drifted, and the screen
showed two different portfolios at once.

### Investment Performance (the INVESTMENT tab)

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
- **Axis** — dollars, and deliberately NOT anchored at zero. A book and a
  deposit line that both sit far above zero would spend most of the
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

## Performance vs S&P 500 panel

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
Fri 16:00 = 4.3 days), so 1W downloads a month at 15m and trims
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
the window with the session's real bars on both sides. Holdings that don't trade overnight (CN funds, `.L` ETFs) simply hold
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

## Market Conditions

The left column's grid of indices / commodities / FX cards is fully
clickable — tap any card to open the same chart modal individual
stocks use, with the full 1D / 1W / 1M / 3M / YTD / 1Y range row. `^GSPC`,
`^NDX`, `^RUT` and `^SOX` additionally surface a **P/E 1Y** button
(Alpha Vantage's trailing P/E for the matching ETF — SPY / QQQ / IWM /
SOXX) with a 3-year-average dashed reference line. Yields render with a `%` suffix, FX
pairs at four decimals, and indices / futures without a currency
prefix so the y-axis matches each instrument's natural scale.

## Sidebar

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
  columns — per-column scaling would draw a small top loser as wide as
  a top winner nine times its size and misreport the shape of the day. Dollar
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
- **Formation Value** — every position's weight as a horizontal bar,
  with its unrealised G/L in dollars and percent.
- **Upcoming Earnings** — the next three future earnings dates across
  the user's holdings, sorted ascending. Date + time format `03 Jun ·
  BMO` / `· AMC` / `· HH:MM` depending on what Yahoo's
  `calendarEvents.earnings` exposes for each ticker. Sits at the
  bottom of the left column on desktop and after the mobile MC strip
  on phones. Powered by the `fundamentals` Edge Function with the 2 h
  `stock_fundamentals_cache` doing the heavy lifting.

## Mobile layout

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

## Install as a PWA

The app is a PWA — on iOS / Android, "Add to Home Screen" gives a
full-screen launcher (the manifest has no icon yet, so iOS uses a
snapshot of the page). When a new version is
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
than one workday behind the latest deploy. The SW itself also checks
`/sw.js` for updates every 60 s, and whenever the tab regains focus or
visibility, so a long-running tab discovers new builds without needing
the auto-reload to fire — combined worst-case stale window: about an
hour (poll + auto-reload).

Click → reload also stashes `dp.swReloadAt = Date.now()` in
sessionStorage and the freshly-mounted page reads it on first paint
to suppress the banner for 2 min, so iOS Safari's flaky SW state
bookkeeping doesn't immediately re-show the same notification right
after the reload (the "click did nothing" loop the user kept hitting
before this guard landed).

### iOS status bar

The installed PWA asks for an **opaque** status
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


---
