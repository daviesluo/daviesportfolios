# Using the board

How each part of the site works, for someone opening it for the first
time. The short tour is the [README](README.md); the file-by-file
map is [map.md](map.md).

## Signing in

There are two passwords. One can edit. The other is a read-only link for
sharing: the same board with no editing controls, no transaction history
and no INVESTMENT chart, and a `VIEWER` badge where the `EDIT` switch
would be. Type either into the prompt, or pass it once
as `?pwd=…` in the URL, which the page removes as soon as it reads it.
The signed token then lasts for the browser session, so a reload or an
update doesn't ask again. It ends 24 hours after signing in, or when the
tab or app is closed; when it ends, the page goes back to the password
prompt by itself, with any unsaved edit kept and saved after the next
sign-in.
If the server does not answer the check, the page says SERVER UNAVAILABLE
and the password was not judged: try again in a minute. Only a password
the server refuses reads "Incorrect password".

An edit is saved a moment after it is made. If the server does not take
it, a **NOT SAVED** bar says so and the page tries again by itself, after
5 s, then 15 s, and longer, for about eight minutes; **Retry now** sends it
at once. The change stays in the tab meanwhile, and a newer edit is saved
in its place. If another tab or device saved first, a **CONFLICT** bar
lets you reload their version or keep editing.

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
- **Opening or reloading the page.** It first shows what it showed last
  time in this browser: the same prices, totals and 24H chart. The new
  prices replace them as they arrive, a second or two later, so the only
  numbers that change are the ones that actually moved.
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
- **Transaction history** (edit password only). Every buy and sale
  across every holding, newest first, closed positions included, with
  the total realised gain in dollars at the top. Sales are entered in a
  holding's editor. A sale's gain folds into the average cost of the
  shares still held, so selling high and buying back lower lowers the
  average cost.
- **Export.** Each table has two buttons by its title: copy
  (tab-separated, pastes into Excel or Sheets) and download (an `.xlsx`
  with filters on the headings). Both export the table in its current
  order, formatted as shown, with the real values even while the eye is
  hiding them on screen.

## The Agents page

The crypto strategies, called **Agents (beta)** in the menu and on the
page: the ones trading real money and the ones still being tested, kept
apart on two tabs. A whole number is written as an integer. Two decimal
places stay when the number is not whole.

- **LIVE and TESTING.** Two tabs at the very top; click one, or use the
  arrow keys, to switch. Each says how many strategies it lists and what
  money is on it. LIVE is real money: **trading** once live trading is
  switched on (a green dot), **not trading yet** before that (amber),
  **selling what it holds** when it can no longer buy but still holds
  coins its exits will sell, **stopped** when a strategy that traded real
  money is off and holds nothing, **paused** under the global pause, or
  **nothing is live**. A strategy that has traded real money stays on
  LIVE, and a live order that needs a person shows on both tabs. TESTING is
  paper, and counts every row as a strategy. The page opens on LIVE while
  anything is live, else on TESTING, and stays on the tab you pick while
  it is open. Every Agents page, the tabs and the pages opened over them,
  keeps one window size.
- **A tab.** A scoreboard in the home page's style: **funded**, the
  capital its strategies are allotted, then **deployed**, what they hold,
  with its share of funded beside the figure, then today, unrealised and
  realised gain. The realised title is the same size as the others; the fees
  sit beside it on the same line, smaller, in parentheses. TESTING's scoreboard adds
  every Stablecoin quotes row and every Reward quotes row with the other strategies. Then a card per exchange —
  Revolut X in blue, which on TESTING includes the Stablecoin quotes rows, and on
  TESTING Polymarket in its blue, whose card is its Reward quotes rows
  added together — showing the same figures for
  that exchange in two groups: what it holds (funded, deployed, today)
  and what it has made (unrealised, realised, and set in under realised
  the parts inside it: its fees, or Polymarket's rewards and orders),
  side by side when a card has the width to itself and one under the
  other otherwise, with its maker and taker fees under its name
  (**funded (Paper)** on TESTING; the accounts' real balances are not
  shown). A bar above the cards shows each exchange's
  share; a slice too narrow for the name shows the percent alone. Then one
  row per strategy: a status dot (green running, amber stale, grey paused),
  its exchange, what it has deployed (the same dollars the scoreboard calls
  deployed), today, unrealised and realised gain, and a countdown
  to its next decision. The stablecoin quotes trade pounds, so their rows,
  and their pages, are in pounds; the tab's scoreboard and the exchange cards
  add them up in dollars at the day's pound rate; the tab says the mode, so a row does not, and a
  live strategy's name does not carry "live". A name does not carry its
  exchange either: the exchange column says it. On a phone each row is a
  card with the same figures, and no line under them says what a percent
  is of. With nothing live, LIVE says
  so and TESTING holds everything. A strategy still holding real coins
  after it was paused or relabelled stays on LIVE until it has sold them.
- **Stablecoin quotes.** The first of the tests, after the testing strategies:
  the live stablecoin quotes' own code, every rule the real-money account
  runs by, trading a simulated Revolut X account of £1,200, £100 a rung:
  resting quotes 0.1–0.3 % either side of the interbank rate on the USDC/GBP
  and USDT/GBP books, placed where the quote test decides each minute. The
  simulated account fills a resting order only when a real trade on the
  exchange went through its price, and only by that trade's size (a trade at
  its price fills nothing, since where it stood in the queue is not known);
  it moves pounds as Revolut X does, rounded to the penny against the
  account; it buys each coin for its asks with a conversion resting at the
  top of the bids, for no fee, so an ask has nothing to sell until that
  conversion fills (the page says so meanwhile); and if its turns stop for
  more than three minutes, its resting orders are cancelled, as the live
  account's are. Its row reads as the live row does, in pounds: funded
  £1,200, deployed every pound at work, today, unrealised on what its coins
  cost, realised with its fees. Tap it for its page, laid out as the live
  page below and marked PAPER, with a line saying what it is. Its record
  starts with the quote test's first minute, 23 Sep. The quote test it
  follows keeps running behind the page until its verdict; its own row and
  page are gone. The foot is when the page was read, and that it refreshes
  every minute.
- **Stablecoin quotes on LIVE.** The live path's own row, once it has
  traded real money on its own Revolut X account. Tap it for a page of its
  own, in pounds, which shows the real-money book and nothing of the paper
  test: the same scoreboard as its row, with the day's loss stop (1 % of
  the capital) beside today. Deployed is every pound at work: the coins in
  the account at Revolut X's index price (the price the account values them
  at; the last trade when the index is more than ten minutes old) and the
  pounds its resting buys tie up. Unrealised is those coins at the index
  against what they cost: the pounds the conversions paid for them, fee
  included, and what the rungs holding paid or sold for. The fees beside
  realised include the conversion fee of the coins each round trip sold.
  Then BOOKS: a card per book, its last trade, fair and index price, and a
  ladder of its rungs, each with the price of the order resting on it, or
  what it holds and has made at the index; under it the book's round trips
  and what they realised. INVENTORY: the pounds and coins in the account, each coin also
  in pounds at the index price shown beside it, and with its unrealised;
  their unrealised add up to the scoreboard's. DAYS: each UTC day's orders, entry
  fills, round trips and what it realised, which add up to realised. Then
  its round trips (entry, exit, size, fees and what each made: a round
  trip that sold coins a conversion bought carries that conversion's fee
  on those coins, in its fees and its P&L). A round trip ends when the
  rung is back to less than the exchange's smallest order: the exchange
  rounds each order's pounds to the penny, so an exit buys back a hair
  less than the entry sold rather than pay the penny over, and that hair
  goes into the rung's next trip. Then its latest orders, with why any
  was refused: EXIT ORDERS first, shown only while there are any, then
  ENTRY ORDERS, each with its side, buy or sell, its price, its size and
  its state (one resting on the book is "open"); a 24-hour stop says so
  under its time. The orders of a round trip that has closed are left
  out, since ROUND TRIPS shows it, so the tables hold what is still
  working: orders resting, and the entries a rung still holds. A cancel
  that filled nothing is left out too, since every re-price makes one,
  and so are the conversions that bought the coins. When an ask cannot go
  out for want of coin (the pound has risen since the coins were bought,
  so each £10 ask needs more of them), the executor buys the shortfall
  itself, resting at the top of the bids for no fee, a few pounds a day
  at most. A warning line shows under the scoreboard only
  when its last turn is late or failed. On a phone the tables keep their
  main columns, sizes included. With values hidden, every amount, price
  and size is hidden too.
- **Stablecoin quotes variant-1.** Right after it, since 3 Oct: the same
  rule and the same quotes, on £600, £50 a rung, so that what the size of a
  rung changes can be read beside it. Its record starts with the quote
  test's first minute too; its page is the same, with £50 rungs. Each
  variant is the same page with its own figures, and the variants are listed
  in the table of twin variants in the agents' reference.
- **Stablecoin quotes variant-2.** After it: variant-1 again, and from 5 Oct
  it also buys or sells at once, as a taker, when the order book has moved
  past a rung by at least the taker's fee, then exits like any other fill.
- **Stablecoin quotes variant-3.** After it (called variant-1 until 3 Oct):
  the same, for the rule with nine rungs a side, from 0.03 % to 0.3 %, whose
  quotes move at every 0.03 % move of fair, an entry only once fair has moved
  at least a third of its rung's distance: on £1,800, £50 a rung, from
  28 Sep. Its page is the same, with nine rungs a side in each book. A
  variant's name in the table is two lines, and the first is the whole of
  "Stablecoin quotes". The paper test of that rule keeps running behind the
  page until its reading.
- **Reward quotes.** After them, on Polymarket (its badge in Polymarket's
  blue): a fourteen-day paper test of small quotes on both sides of the
  markets that pay liquidity rewards, $300 of them chosen afresh each UTC
  day, decided every minute from the public order books and trades. Its row
  reads like a strategy's, on a cap of $1,000, as each Reward quotes row
  has, and its "N open" is how many rows its page's quotes table has (the
  markets quoted today and those still held from an earlier day), on every
  Reward quotes row (what its markets have at work each day is the days table's Costs
  column, which the test's rule sets without looking at the cap); deployed is
  every dollar at work, what its quotes resting now tie up (a bid's Yes at
  its price, an ask's No at one minus its price, each at its size) and what
  it holds at the mid; realised is
  the rewards and what closed trades made, unrealised what it still holds
  (in Yes or No shares) at the mid. Tap it for its page: the same
  scoreboard, with realised split into the rewards and what its orders
  made, each on its own line; a status row (the pessimistic total, how much of the
  total sits in one market, how many markets it is quoting today, how many
  positions are still held); the days, including the UTC day still open,
  with the same worst case as the tile above; then today's quotes, and the latest fills, shares to two decimal places when they are not whole, then price. The foot
  is when the page was read, and that it refreshes every minute. A fill is one print, so the fills table has no profit
  of its own — that sits on the quote row and on realised. Every part that is printed beside a total adds up, to the cent, to
  that total. The rewards are worked out from
  Polymarket's published formula against the book as it stood, so they
  are an upper bound: only an account that quotes shows what Polymarket
  actually pays. The first day was a warm-up that counts nowhere.
- **Reward quotes variant-1 to variant-4.** The four rows after it: the
  same quotes, each with a rule changed, so they can be compared side by
  side with Reward quotes; which rule each changes is not on the site (it
  is in the reference, §4 item 36). Variant-3 and variant-4 are built on
  variant-2 and each change one thing more: where the quotes rest. Each
  holds its own positions and makes its own profit and loss, worked out
  from the same order books and trades Reward quotes reads, and each is
  brought up to date every minute. Their pages are Reward quotes' page,
  for their quotes, which are each row's own prices. Each shows only what
  it did under its own rule: it counts from the minute that rule starts
  (variant-1 from 27 September, variant-2 from 28 September, variant-3
  and variant-4 from 3 October, each at 01:00 UK time), anything it held
  then is counted from that minute's price, and nothing from before is
  shown. Until then its row says when it starts. A warning appears on a
  page only if its copy of the rows it came from stops matching them. Two
  earlier variants, one that paused after a jump in the price and one
  with both of the first rules, are still worked out but are not rows:
  the first did worst of the variants over their first four days, and the
  second does, market by market, exactly what one of the others does.
- **Reward quotes confirmation.** From 8 October, the row after the variants: Reward
  quotes' own rule run again, forward, for fourteen more days, 9 to 23
  October, to see whether what it did in its first fourteen holds on days
  nobody has seen. It is not on the page before then. It keeps its own
  positions and records, on its own cap of $1,000, and its page is Reward
  quotes' page. 8 October is a warm-up that counts nowhere; until
  9 October 01:00 UK time its row and its page say when it starts and show
  nothing else, and after 23 October it is finished.
- **Reward quotes mini-pool.** On Polymarket, two rows before the last: a
  paper test, before real money, of exactly what the account that will
  quote on Polymarket would do (until 2 October it was called small-pool,
  and live-prep before that; that name is the last row's now). That account is built and runs every minute
  without sending anything: it picks the day's markets (rewards of $6 to
  under $10 a day), works out its bid and ask in each, and writes down
  every order it would send. It quotes up to eight markets a day, the
  size the account will go live at, and it goes live only when Davies
  says so. This row fills those very orders on paper
  from the trades the public sees, two minutes behind the clock, and keeps
  what they would hold, at the mid, and what they would have made. Its cap
  is the account's own limit; deployed is what its resting quotes tie up
  and what it holds, as on Reward quotes. Its page is Reward quotes' page:
  the same scoreboard and status; the days, each with what its markets'
  quotes need, its fills, its rewards and what it made, adding up to the
  total; today's markets, each with the bid and ask the account had
  resting (or why there were none of the rule's), its share of the pool,
  what it holds, and what its rewards and orders made; and the latest
  fills, as the account trades them: it buys No where Reward quotes sells
  Yes, so it can hold both. It keeps no worst case for each day, so that
  column shows a dash; the running one is in its status. If the account's
  own loss limit would have been hit, its dot turns amber and says so:
  from then on, as the real account would, it only sells what it holds.
  From 4 October its rewards are worked out with its own quotes in the
  market's order book, as Polymarket works them out, and from 5 October
  it prefers markets whose order book has depth: on each side, at least
  two prices within 10 cents of the best one, each holding the reward's
  minimum size. It takes a thinner market only when too few have it.
- **Reward quotes mid-pool.** The row after mini-pool, on Polymarket: the same test
  on bigger pools, markets paying $10 to under $50 a day in rewards, for
  fourteen days. It is the same code as mini-pool, at the same size
  (up to eight markets a day, a $320 cap), and the same real order
  path: like mini-pool it only writes down what it would send, and this
  row fills those orders on paper the same way, until Davies says go.
  Both use the same Polymarket account, so only one of the two can ever
  be live. It never picks a market that the other Reward quotes tests
  quote, and leaves out the ones close to them too. Its row and its
  page read exactly like mini-pool's, and from 4 October its rewards are
  worked out the same way.
- **Reward quotes live-prep.** The last row, on Polymarket: the strategy
  the study of 4 October found best on everything recorded, and since
  that day the lead candidate to go live. It is the same account and
  the same real order path, on every market paying $10 a day or more in
  rewards (the markets the other Reward quotes tests quote included), up
  to ten markets a day and $200 of quotes, $100 a market and $320 in all.
  It sells what it holds before it buys more, stops adding to a side at
  five times its order size, stays out of a market for an hour after its
  price jumps 15 cents, leaves out weather markets, and keeps selling what
  it still holds in a market it no longer picks. It stops for good if its
  orders' result plus what Polymarket paid falls to −$75. Until Davies
  says go it only writes down what it would send, deciding as if it held
  what this row's paper holds, and this row fills those orders on paper
  the same way as the rows above. Only one of the three can ever be live.
  Its row and page read like mini-pool's.
- **A strategy.** Tap a row to open it over the list. The same refresh
  button sits beside ✕, and ✕ brings the list back as it was. The minute
  refresh keeps going on this page, and on the quote pages, the same as
  on the list. Its head says PAPER or LIVE, then its exchange in that
  exchange's colour, as every strategy's and test's page does, both tags
  the same height; then whether it is running, and how long it has been
  under test, to the hour ("tested 3d 14h"; "live 3d 2h" on the live
  row). It shows its own scoreboard and positions, a
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
  on that coin in the window, newest first. Load full history appears
  under that table only when the coin has orders older than the window.

The page opens on what it showed last time in this browser, the first
time after a reload included, and refreshes behind it: as it opens, then
every minute while it is open. Everything on it is worked out by the
`agents` function; the page only formats it.

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
the portfolio is worth. The read-only password shows PERFORMANCE VS S&P 500 alone.
The panel moves with the page: every 30-second refresh brings in the new
prices, and the new bars once the ones on screen are out of date (every
five minutes on 24H, and every minute for the S&P's own on 24H and 1W),
and the refresh button fetches the whole window again at once. On 24H and
1W the portfolio's line reaches the current minute at live prices, while
the S&P's line ends at its last price: the S&P futures reach the site
about ten minutes late (the exchange's delay on free prices), so while
they trade the S&P line stops a little short of the portfolio's.

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

On 24H, dashed lines mark the US market's OPEN (9:30 in New York, 14:30
UK time for most of the year) and CLOSE (16:00 in New York, 21:00 UK
time) with extended hours on; with them off, only the OPEN, while the
market is open. Each is drawn only when that moment falls inside the
window. Only the times the market traded are drawn, so at the weekend
the window holds just the end of Friday's session: the futures' last
hour or so, the S&P's last few minutes. The faint vertical lines are the
time axis's gridlines, one under each time label.

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

## When a part of the page fails

Each part of the page stands on its own. If one fails while it draws — a
panel, the header, the board, the sidebar, a list, a chart or an Agents
page — that part alone says **This panel failed to load** (in a page
opened from the menu, **This page failed to load**) with a **Retry**
button, and the rest of the page keeps working. **Refresh** retries every
failed panel as well. Each failure is sent to the errors badge (desktop,
edit password), named by the part that failed.

The errors badge also carries the production monitor's alerts. Every
minute it checks the live site, the database's minute loop and the live
stablecoin quotes. A check that has failed for two minutes running shows
as `monitor.alert`, named by the check (`site`, `loop` or `pr5`), and
`monitor.recovered` follows when it passes again. `monitor.deadman` means
the stablecoin quotes' executor stopped turning and every order it had
resting on the exchange was cancelled; it quotes again by itself when it
comes back. The same alerts open, or add to, a GitHub issue labelled
`monitor`.

`agents.pm_rec` is the Polymarket recorder, which keeps the rewarded
markets' order books, reward terms and trades for research: a read it
could not make, an hour it could not archive, or one of its two calls
not running. It shows once, then at most hourly while the fault lasts.
Nothing on the page and no strategy reads the record, so it never stops
a strategy.

Every live price is checked before the board takes it. One that cannot
be the holding's — a hundred times off (pence read as pounds), another
stock's or fund's price relayed by a public proxy, or not a number at all
— is held: the board keeps the last good price, the errors badge lists it
as `quote.held` (or `quote.bad`) under its ticker, and the next refresh
asks again, of the other source too. A real move passes however large it
is, since it comes with the previous close the board already knows. One
that does not (a split, an IPO's first minutes) is shown as soon as the
price function and a public proxy agree on it, or after five minutes of
the same answer.

## On a phone

Below 1020 px wide the page becomes one column: the header, the board or
heat map, the sidebar, then Market Conditions as a 3 × 3 grid. An open
modal holds the page still behind it, so dragging inside the modal
doesn't scroll the board, and closing it puts you back where you were.
On a phone the modal is the page, title included, down through the
strip under the browser's toolbar. The board is not sitting behind it.

## Installing it

On iOS or Android, "Add to Home Screen" installs it as a full-screen app
that also works offline. When a new version is out, a banner at the top
offers RELOAD; left alone, the app reloads by itself after an hour. It
checks for a new version every minute and whenever you come back to it.
The new version opens the way a reload does, on what the page last
showed, and keeps your settings, hide-values included.
