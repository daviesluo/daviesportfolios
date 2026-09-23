# Using the board

How each part of the site works, for someone opening it for the first
time. The short tour is the [README](README.md); the file-by-file
map is [map.md](map.md).

## Signing in

There are two passwords. One can edit. The other is a read-only link for
sharing: the same data, no editing controls, and a `VIEWER` badge where
the `EDIT` switch would be. Type either into the prompt, or pass it once
as `?pwd=…` in the URL, which the page removes as soon as it reads it.
The signed token then lasts for the browser session, so a reload or an
update doesn't ask again.

## The header

- **Clock and market phase.** UK time (BST or GMT, as the season says)
  and a dot for the US market: green open, gold pre-market, purple after
  hours, blue overnight.
- **Extended hours.** Off, the board shows the regular session. On, the
  indices switch to their futures (`^GSPC` → `ES=F`, and so on) and the
  day's change is measured from today's regular close, so after-hours
  moves show.
- **Hide values (the eye).** Replaces every digit of money, price and
  share count with `•`, so the page can be shown or screenshotted.
  Percentages stay. The setting is remembered.
- **Tactics board / heat map.** Switches the centre panel.
- **Refresh.** Fetches prices now and re-warms every chart range in the
  background. Prices also refresh by themselves every 30 seconds through
  the trading week, overnight sessions included, and every 5 minutes at
  the weekend, when nothing trades.
- **☰ menu.** The holding list, the sectors list, the transaction
  history and the Agents page.

## Tactics board

Each card is a position on the pitch (GK, CB, CDM, CM, LW, ST, RW …)
holding one sector's stocks. The card with the largest single holding
wears the captain's armband, and the ball sits by the holding with the
biggest move today (the extended-hours move when that switch is on).

- **Tap a card** to list its holdings, largest first.
- **Tap a ticker** to open its chart.
- **Edit mode** (edit password only): tap a card to add a ticker, tap
  the goalkeeper to change cash, rename a sector in place, or drag one
  card onto another to swap them. The slots stay where they are and the
  sectors trade places, like two players swapping positions. Dragging
  works on touch screens too.

## Heat map

One tile per holding (cash excluded), sized by its value in dollars and
coloured by today's move: green up, red down, deeper for a bigger move.
Tap a tile to open its chart.

## Holding list, sectors list and transaction history

- **Holding list.** Every holding in a sortable table: symbol and name,
  exposure, cost basis, market value, the day's change and the
  unrealised gain, in dollars and percent. Tap a heading to sort (largest
  exposure first by default), and a symbol to open its chart over the
  list. On a phone the symbol column stays put while the numbers scroll.
- **Sectors list.** The same table grouped by sector, each group headed
  by its position and name (`ST · Neocloud`) and its totals. Sorting
  orders the sectors and the holdings inside them.
- **Transaction history.** Every buy and sale across every holding,
  newest first, closed positions included, with the total realised gain
  in dollars at the top. Sales are entered in a holding's editor. A
  sale's gain folds into the average cost of the shares still held, so
  selling high and buying back lower lowers the average cost.
- **Export.** Each table has two buttons by its title: copy
  (tab-separated, pastes into Excel or Sheets) and download (an `.xlsx`
  with filters on the headings). Both export the table in its current
  order, formatted as shown, with the real values even while the eye is
  hiding them on screen.

## The Agents page

The crypto strategies, all on paper today, which is why the menu and the
page call it **Agents (beta)**.

- **The list.** A scoreboard in the home page's style (deployed, today,
  unrealised and realised gain, each with its percentage), a card per
  exchange — Revolut X in blue and Binance in its yellow, where the same
  strategies run as paper twins, deciding alike and filled at Binance's own
  prices — showing **funded (Paper)**, the capital its strategies are
  allotted (the label says it is paper while no strategy there trades real
  money), **deployed**, what they hold, then today, unrealised, realised and fees (the accounts' real
  balances are not shown: nothing trades them), and one row per strategy: a status dot (green running,
  amber stale, grey paused), its exchange, its mode (LIVE in green,
  PAPER in a dashed outline, or PAUSED), today, unrealised and realised
  gain, and a countdown
  to its next decision. Live strategies are listed apart from the ones
  still being tested.
- **A strategy.** Tap a row to open it over the list; its ✕ brings the
  list back as it was. It shows its own scoreboard and positions, a
  countdown to the next decision, and **LIVE STATE**: what the loop sees
  for each coin right now (trend, strength, breakout, volatility,
  momentum, position, unrealised gain, time held) and when that last
  changed.
- **The chart.** One tab per coin. The line is the closing price on the
  exchange the signal comes from (Kraken), over its high–low band, drawn
  in the colour of the exchange the strategy trades on. Green
  up-triangles are buys, red down-triangles sells, a dashed segment is
  an order still resting, and a dotted line is the average cost. Hover
  for the time, the close and any fill. Under the chart is every order
  on that coin, newest first.

The page loads in the background after the board first paints, and
refreshes every minute while it is open. Everything on it is worked out
by the `agents` function; the page only formats it.

## Ticker chart

Opens from any holding, tile or Market Conditions card.

- **Ranges.** 1D, 1W, 1M, 3M, YTD and 1Y. A profitable stock, and the
  S&P 500, Nasdaq 100, Russell 2000 and semiconductor index, also get
  **P/E 1Y**; a company without profits gets **P/S 1Y** in the same
  place. Chinese funds and private holdings only have daily prices, so
  they show 1M to 1Y. ETFs, futures, other indices, crypto and
  currencies get neither valuation button.
- **1D** covers the last 24 hours, with dashed markers at the previous
  close and today's open (only the close for markets without US-style
  extended hours, such as London, Europe and OTC ADRs). The percentage
  is measured from the previous regular close, the same figure the
  scoreboard and the heat map show. While it is open the chart keeps
  polling, so new bars appear by themselves.
- **P/E 1Y** divides each day's price by the trailing twelve months'
  earnings as of that day, so the line steps on earnings days. A dashed
  line marks the three-year average.
- **Hover** for a crosshair with the price and the change from the
  start.
- **Copy or save** the chart as an image with the two buttons by the ✕.
  On a phone, save opens the share sheet, so the image can go straight
  to the photo album.
- The other ranges are fetched in the background, so switching range is
  usually instant.

## Performance panel

Two tabs share one slot and one range: **VS S&P 500** (it reads VS S&P
FUT while the benchmark is the futures contract) and **INVESTMENT**.
Both come from the same valuation, so they can't disagree about what
the portfolio is worth.

### VS S&P 500

The portfolio's return against the S&P 500 over 24H, 1W, 1M, 3M or YTD.
**Both lines start at 0 % at the left edge of every range**, so the chart
answers one question: how did the two move against each other over this
window. That is why the shortest range is 24H, a trailing 24 hours, and
why it won't match the scoreboard's DAY CHANGE, which is measured from
yesterday's close. 1W is a real seven days.

With extended hours on, 24H and 1W use the S&P futures instead, and the
title and legend say so. The futures line then runs through the night,
and the portfolio line follows the overnight prices recorded from
Trading 212 instead of staying flat; holdings that don't trade overnight
stay flat. Hover to read both returns at that moment, with its date or
time.

### INVESTMENT

- **Value** is the portfolio in dollars. Its right-hand end is the
  scoreboard's PORTFOLIO figure.
- **Deposited** is the money paid in, net of sales, drawn as steps that
  move only on the day of a buy or a sale. Money in other currencies is
  converted at a rate fixed once and kept, not at today's rate, so the
  line moves only when money does.
- The legend gives each line's own move over the window, in percent.
- The dollar axis doesn't start at zero, so both lines keep their shape.
- **The faded stretch.** Before the server started recording prices
  every five minutes, the line is rebuilt from the ledger and daily
  prices. That part is drawn faded, with a dotted RECORDED rule where
  the record starts and a `~` on its hover readings. The recorded part
  grows every day.

## Market Conditions

The grid of indices, commodities, yields and currencies on the left.
Every card opens the same chart as a stock, 1D to 1Y. The S&P 500,
Nasdaq 100, Russell 2000 and semiconductor index also get **P/E 1Y**,
from the P/E of the ETF that tracks each. Yields show a `%`, currencies
four decimals, and indices and futures no currency sign.

## Sidebar

- **Top Movers.** The biggest real winners and losers, up to five each.
  Pick the window (TODAY, 1W, 1M or 3M) and the measure: `%` shows what
  moved most, `$` what moved the portfolio most. A holding that didn't
  move doesn't pad the list, and a side with no movers shows a dash.
  Over 1W to 3M the move covers only the time the position has been
  held: a stock bought two days ago shows two days on the 1M list.
  TODAY is measured from yesterday's close for everything, as on the
  heat map. Both choices are remembered.
- **Formation Value.** Each position's share of the portfolio as a bar,
  with its unrealised gain.
- **Upcoming Earnings.** The next three earnings dates among the
  holdings, with the fiscal quarter and the time where Yahoo gives one:
  before the open, after the close, or a clock time.

## On a phone

Below 1020 px wide the page becomes one column: the header, the board or
heat map, the sidebar, then Market Conditions as a 3 × 3 grid. An open
modal holds the page still behind it, so dragging inside the modal
doesn't scroll the board, and closing it puts you back where you were.

## Installing it

On iOS or Android, "Add to Home Screen" installs it as a full-screen app
that also works offline. When a new version is out, a banner at the top
offers RELOAD; left alone, the app reloads by itself after an hour. It
checks for a new version every minute and whenever you come back to it.
