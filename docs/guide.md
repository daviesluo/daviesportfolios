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
sign-in (unless another tab or device has saved in the meantime: then
the CONFLICT bar below asks first).
If the server does not answer the check, the page says SERVER UNAVAILABLE
and the password was not judged: try again in a minute. Only a password
the server refuses reads "Incorrect password".

An edit is saved a moment after it is made. If the server does not take
it, a **NOT SAVED** bar says so and the page tries again by itself, after
5 s, then 15 s, and longer, for about eight minutes; **Retry now** sends it
at once. The change stays in the tab meanwhile, and a newer edit is saved
in its place. If another tab or device saved first, a **CONFLICT** bar
lets you reload their version or keep editing. The same bar comes up
when the page reloads holding an edit it never saved and another tab or
device has saved since: your edit is shown, nothing is saved over theirs
until you choose, and keep editing means your next edit's save replaces
theirs.

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
- **UNREALIZED G/L.** What the holdings on the board would gain if sold
  now, against what they cost; its percentage is that gain over their
  cost, with cash left out (cash still counts in PORTFOLIO and in the
  day's change). Each position card reads its own holdings the same way.
  The cost is net of the dividends each position has paid, so on a first
  visit (or a week after the last) it reads `—` until they have loaded,
  as does each FORMATION VALUE row's gain; after that a reload shows the
  figure the page showed before, never one without the dividends.
- **Currency (💱).** Shows the scoreboard's three amounts in dollars,
  pounds or yuan at the live rate, starting in dollars on every visit.
  Until that rate has loaded they read `—`, never the dollar figure
  under another currency's sign. On a first visit (or a week after the
  last), the three amounts and their percentages read `—` too until the
  exchange rates of the holdings priced in pounds or yuan have loaded,
  rather than a total that counts them as dollars. So does everything
  else that needs those rates: a position card holding one, FORMATION
  VALUE, Top Movers in dollars, the captain's armband, the heat map
  (empty until then), the performance chart ("Loading…") and the
  dollar figures of the position, holding and sector lists.
- **Tactics board / heat map.** Switches the centre panel.
- **Refresh.** Fetches prices now and re-warms every chart range in the
  background. Prices also refresh by themselves every 30 seconds through
  the trading week, overnight sessions included, and every 5 minutes at
  the weekend, when nothing trades.
- **Opening or reloading the page.** It first shows what it showed last
  time in this browser: the same prices, totals and 24H chart. The new
  prices replace them as they arrive, a second or two later, so the only
  numbers that change are the ones that actually moved.
- **☰ menu.** The holding list, the sectors list, the target price
  page, the transaction history and the Agents page.

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

## Holding list, sectors list, target price and transaction history

- **Holding list.** Every holding in a sortable table: symbol and name,
  exposure, cost basis, market value, the day's change and the
  unrealised gain, in dollars and percent. Tap a heading to sort (largest
  exposure first by default), and a symbol to open its chart over the
  list. On a phone the symbol column stays put while the numbers scroll.
- **Sectors list.** The same table grouped by sector, each group headed
  by its position and name (`ST · Neocloud`) and its totals. Sorting
  orders the sectors and the holdings inside them.
- **Target price.** Every holding beside what analysts expect of it: its
  weight in the book (the Holding list's exposure), the price on the
  board, the average target with the upside from the price, the average
  rating (1 Strong Buy to 5 Sell), the lowest and highest target, how
  many analysts, the range of the targets set in the last 30 days with
  how many there were, the lowest target against the price, and a short
  note of key risks. It opens sorted on the lowest target against the
  price, largest first; tap any heading but Key risks to sort, again to
  turn it round, and a holding without targets always sits last with
  `—`. Stocks show the analysts' consensus from Yahoo Finance. A fund
  (VUAA, SAEM) has no consensus of its own, so it shows its holdings'
  targets weighted by their share of the fund, tagged
  *holdings-weighted* with the share of the fund they cover; a holding
  whose average target is under half or over twice its own price is
  left out as implausible and counted on the tag as *skipped* (hover the
  tag for the detail). Bitcoin shows banks' published targets kept by
  hand, tagged *strategist targets* (hover the row for each firm, date
  and horizon). The targets refresh by themselves at 04:00, 09:30 and the
  close (New York time) on trading days and at 09:30 on other days;
  "Updated" under the title says when. The page opens with its figures
  already there, read when the site loads.
- **Transaction history** (edit password only). Every buy, sale and
  dividend across every holding, newest first, closed positions
  included, with the total realised gain in dollars at the top (`—` for
  the moment after a load, until the trades and the dividends it counts
  have loaded). Sales are entered in a holding's editor. On a purchase, Avg Cost is what the
  position cost per share afterwards, with earlier sales' gains and the
  dividends received folded in, so selling high and buying back lower
  lowers it, and so does every dividend. On a sale, it is the average
  price paid for the shares less the dividends they had paid, which is
  what the realised gain is measured against: shares × (price − Avg
  Cost), a closing sale included. A position sold out shows exactly
  what came back less what it cost, plus every dividend it paid, in the
  currency the listing trades in, converted at today's rate.
- **Dividends.** Each dividend Trading 212 paid is a row of its own,
  marked DIVS: the shares it was paid on, the cash received (after any
  tax withheld) in the holding's currency, and the Avg Cost after it.
  One payment is one row: when a company pays both accounts on the same
  day (or pays a dividend and a return of capital together), the row
  adds their shares and their cash, and its Avg Cost is the one after
  all of it. Totals and every other row read the same either way.
  It realises nothing while you hold the shares; it lowers what they
  cost instead. A dividend paid in another currency than the holding's
  (the ISA pays in pounds on a dollar stock) is converted at that day's
  closing rate. The same dividends lower the average cost everywhere
  else the site shows one: the position cards, the ticker page, the
  holding list's cost basis and the holding editor.
- **Currency.** Each fill is booked in the currency Trading 212 says the
  listing trades in, not the one its symbol suggests: some London
  listings trade in dollars and some in pence, and pence are booked as
  pounds. If the broker ever disagrees with what the board expects, the
  errors box says so.
- **Sold at Trading 212.** When you sell a position in full at Trading
  212, the board takes those shares off at the next refresh once both
  accounts answered and the sale is in the broker's fill history; shares
  you hold at another platform stay. If it cannot confirm the sale, the
  board is left as it is and, after ten minutes, the errors box says
  which holding and why.
- **When fills arrive.** The site reads Trading 212's fill history and
  dividends every ten minutes by itself, whether the page is open or
  not; while the page is open and in view it also reads them every two
  minutes, so a fill shows soon after it is made.
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
  every Stablecoin quotes row with the other strategies. Then a card per exchange —
  Revolut X in blue, which on TESTING includes the Stablecoin quotes rows, and on
  LIVE Polymarket in its blue, whose card is the Polymarket analyst's (and
  the real-money Reward quotes' while that is armed) — showing the same figures for
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
  fills, round trips and what it realised, which add up to realised; its
  heading shows what the seven full days before today made (a day with no
  trading counts as nothing), as a yearly rate on the
  capital (every Stablecoin quotes page has it). Then
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
- **Stablecoin quotes variant-3.** After it, since 18 Oct: variant-2 again,
  and from Friday 23 Oct at 21:00 UTC it also quotes at weekends. When the
  pound-dollar rate stops updating at the Friday close, it keeps quoting on
  the last rate it had instead of going quiet, until Sunday 21:00 UTC. It
  started on 19 Oct with a fresh record, so its figures before the first
  weekend are its own, not variant-2's.
- **Stablecoin quotes variant-4.** After it (called variant-1 until 3 Oct,
  variant-3 until 18 Oct): the same, for the rule with nine rungs a side, from 0.03 % to 0.3 %, whose
  quotes move at every 0.03 % move of fair, an entry only once fair has moved
  at least a third of its rung's distance: on £1,800, £50 a rung, from
  28 Sep. Its page is the same, with nine rungs a side in each book; from
  10 Oct the innermost, 0.03 %, quotes nothing (it earned about nothing),
  and its row stays on the page with what it made before. A
  variant's name in the table is two lines, and the first is the whole of
  "Stablecoin quotes". The paper test of that rule keeps running behind the
  page until its reading.
- **Stablecoin quotes with Euros.** Right after "Stablecoin quotes
  variant-4", its name on two lines as the variants', on Coinbase (its own
  badge and venue card): the same rule on paper on Coinbase's four stablecoin
  books, USDC and USDT against pounds and against euros, from Coinbase's own
  public trades recorded every minute since 10 Oct. £100 a rung on the two
  pound books and €100 a rung on the two euro books, six a book: £1,200 plus
  €1,200, counted in pounds at the latest euro rate. Every money figure is in
  pounds; a euro book's prices are shown in euros. Its page is the twins'
  page without INVENTORY, since a paper test holds no coins of its own (what
  a rung holds is in BOOKS), so its DAYS and 7-day annualised figure read
  straight beside the live row's on Revolut X.
- **Stablecoin quotes with Euros - 2.** Right after it, the same test with
  one change, the weekend: the first goes quiet from Friday evening to Sunday
  evening, when the exchange rates it prices from are not published, and this
  one keeps quoting on Friday's rates until they come back. Its name is on two
  lines, its page is the first's, and Coinbase's card adds the two. A paper
  test, starting at the next midnight after it went up; the rule for judging
  it is written down first.
  Since 15 October both Coinbase tests also step aside for seven minutes
  around each scheduled data release (US inflation and jobs, the Fed, the ECB,
  the Bank of England), when the market jumps faster than a quote can follow.
- **No paper Reward quotes since 13 October.** The paper tests of quoting
  for Polymarket's liquidity rewards (Reward quotes, its variant-1 to
  variant-4, and Reward quotes mid-pool) left TESTING and stopped on
  13 October: none was making money, and a study that day found quoting
  near the best prices loses across every rewarded market. Their records
  are kept; TESTING has no Polymarket row or card now.
- **Reward quotes on LIVE.** Live-prep's real-money book, a row of its own
  on Polymarket from 9 October, when it went live, called Reward quotes
  there; nothing of it is on TESTING. Since 17 October it is off LIVE while
  it is disarmed: it sold what it held and was switched off, and its
  account is the one the Polymarket analyst's $100 comes from, so LIVE
  counts that money once, as the analyst's. Its record is kept, and armed
  again it is LIVE's row again. What follows describes the row. Funded is
  the money Davies has put into its account: worked out every minute from
  what the account holds and what it has done, so rewards and trading never
  move it, and a deposit or a withdrawal shows a few minutes after it lands
  (none is counted between midnight and 03:10 UTC, while Polymarket's
  payouts arrive). It never shows the cap: until the strategy has
  recorded the money put in, it shows its latest reading of it, and a dash
  when there is none. Behind it, the most it may commit follows the account:
  each day's rewards and any money added raise that the minute after they
  arrive, a withdrawal or a loss lowers it at once, up to $1,000; deployed is what its resting buys tie up
  plus what it holds at cost; today, unrealised and realised come from its
  confirmed fills at the last minute's mid prices, and realised also counts
  the rewards and rebates Polymarket actually paid, less any fee its trade
  records show (none so far: its orders only ever rest, and Polymarket
  charges only the side that takes). Tap it for a page of its own: the same
  scoreboard, then STATUS: R (PAID ÷ FORMULA), what Polymarket paid over what the
  reward formula gave in every minute our orders were quoted live, on the days
  a payout has been read (9 October, the first day, counted at the rates Polymarket
  actually paid that day; a dash until the first; Polymarket's payout is read
  from five minutes past midnight UTC, so it moves within minutes of arriving).
  One figure, nothing under it. Then the markets quoting today (today's markets less
  any taken out right now: a market taken out, its reward changed or ended, is
  replaced after fifteen minutes (only once at least $20 of its buying budget is
  free, so a replacement can actually be quoted), at once if none is quoting, by the next best
  market of a reserve the strategy ranks once a day after midnight UTC and
  whose reward it checks every minute, at most ten a
  day, and never takes one back the same day; a market whose trades are
  $10 or more down, what it holds valued at the market's middle price, buys
  nothing more until that recovers, while what it holds stays on sale);
  the positions still held; and REWARDS
  TODAY (EST.), in green, what today's quotes have earned since midnight
  UTC as a range from low to best, counting only the minutes Polymarket
  confirmed them scoring. It moves every minute, starts again
  from nothing at midnight UTC, and its band of R comes from the days
  Polymarket has paid (until the first, from the studies' 0.2 to 1), so
  each payout read narrows it by itself. Then DAYS,
  each of those days with the markets read, Orders (what its trades made that UTC
  day, rewards not counted: what its sales and any market that settled that day
  realised, plus how what it held moved, valued at the market's middle price at
  midnight and, for today, now), the formula over every quoted minute, what was paid,
  R (the same R as the STATUS tile) and the rebates; today, and yesterday until its payout is read, show their
  Orders alone. The days' Orders add up to the orders' part of REALIZED G/L plus
  UNREALIZED G/L;
  and QUOTES (each
  market with an order resting now or a token held, the day's first, then
  any held from an earlier day: its pool, the prices its live orders rest
  at, a dash on a side with nothing resting, what it holds of each token;
  Rewards (est.), what Polymarket has paid for the market plus, for each
  day whose payout has not been read yet, the reward formula's figure for
  it times the market's best estimate of R, which every payout read
  refines; what its orders have made; and Total (est.), the two added up,
  all moving every minute). The estimates are on this table and the
  STATUS tile only: the scoreboard counts only money actually paid. Then
  FILLS (a fill Polymarket has not confirmed
  yet is marked and counted nowhere). Under the scoreboard, a line gives its
  −$75 total stop's room: the stop watches the same total the page adds up
  (trades valued at the middle price, plus rewards and rebates paid, less any
  fee), so "$78 of room" means the total can fall $78 before the strategy
  stops buying. Should the stop ever trip, a red line there says so instead. Hide values masks every amount on it.
  Once Davies restarts the strategy after a stop, the line counts from the
  restart instead: "total stop at −$25 since 10-13 02:31 UTC: $21.50 of room
  (since then −$3.50)" is what its trades, rewards and rebates have made since
  that minute, and the earlier stop is history. That day's markets are chosen
  again at the restart, and the markets chosen before it are listed with what
  they still hold.
- **Polymarket analyst on LIVE.** An outside Grok agent trading a
  $100 budget on Polymarket on information: outcomes already confirmed while
  the price lags, and researched mispricings in quiet markets. It holds no
  key: it asks this site's server in Ireland, which checks every order
  against its fixed limits (a few dollars a market, six positions, a cash
  floor, a daily and a total stop, no long shots, no near-certain favourites
  unless the outcome is already confirmed, no thin books) and against its own
  trades only, and refuses what breaks them before anything is sent. Until
  Davies says go it runs as a dry-run: its orders are checked and journalled
  and none is sent. Its light in the list is then amber, and its page says
  DRY-RUN in the same amber where a live strategy says LIVE. Funded is its
  $100 budget, shown on its row and page and counted in LIVE's funded total
  from now. Every other dollar on its row and page is read from Polymarket's
  public record of its own trades every five minutes, never from what the
  agent says, and stays at zero until the go. Its page's scoreboard is laid
  out as the live Stablecoin quotes page's and reads the same figures as its
  row: funded, deployed (what it holds, at cost, with its share of funded),
  today, unrealised, and realised, which already counts its fees (shown
  beside it, as "incl. fees"); under them, the room left on both stops. A
  red line appears when the agent's own report differs from that record by
  more than $1. STATUS shows the open positions, the cash, how well its
  probabilities scored against the market's prices on the markets that have
  resolved (the Brier score: lower is better, its own first), and how many
  have resolved. Then POSITIONS from the record; DAYS, each day's result
  from the record beside the one it reported; and last the JOURNAL, its
  latest decisions, each with its time in UTC, what it did, the market's
  title as an underlined link to that market on Polymarket ("market title
  pending" until the site has read it), the probability it gave against the
  market's price it saw and the difference in points, its reason, what would
  prove it wrong, and its sources as underlined links named by their
  website. Hide values masks every amount,
  price and size; probabilities and scores stay.
- **Reward quotes mini-pool** (markets paying $6 to under $10 a day, the
  first test of that account) left the list and stopped on 8 October: its
  checks had closed and it is not a candidate to go live.
- **Reward quotes live-prep.** No longer a row of TESTING since 10 October
  (it traded real money as LIVE's Reward quotes, off LIVE since 17 October
  while disarmed); its paper copy
  stopped on 13 October. What follows describes the strategy. On Polymarket: the strategy
  the study of 4 October found best on everything recorded, and since
  that day the lead candidate to go live. It is the same account and
  the same real order path, on every market paying $10 a day or more in
  rewards (whatever else quotes them), up
  to ten markets a day and $200 of quotes, $100 a market and $320 in all.
  It sells what it holds before it buys more, stops adding to a side at
  five times its order size, buys a side priced 0.95 or more only while
  what it holds of that side plus the order stays within 8 % of its
  capital (so the limit grows with the capital), stays out of a market for an hour after its
  price jumps 15 cents, leaves out weather markets and, since 10 October, markets about AI
  (model releases, model rankings, AI companies), and keeps selling what
  it still holds in a market it no longer picks. Every minute, before it
  places anything, it checks each market's reward programme again: a
  market whose rewards have ended, dropped under $10 a day or now need
  bigger orders than it places stops buying that minute (it keeps selling
  what it holds), and one where Polymarket says three minutes running that
  its orders are not earning stops buying for the rest of the day. It stops for good if its
  orders' result plus what Polymarket paid falls to −$75. Since 13 October (Davies' choice
  after its stop) it quotes only quiet markets: a market where at most 50
  shares changed hands in the last 24 hours and whose best prices are at
  least 4 cents apart, checked on Polymarket's public trade record before it
  is picked; it rests nothing while a market's prices are closer than that,
  stops adding to a side at twice its order size, picks markets for up to 90 %
  of what it may commit, and its stop is −$25 counted from the restart. Were Davies to
  take it off real money, it would only write down what it would send.
  The account's three order paths (this one, and mid-pool's and
  mini-pool's, both stopped) share it, so only one can ever be live.
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

- **Ranges.** 1D, 1W, 1M, 3M, 6M and 1Y (6M is the last six months; it
  replaced the chart's year-to-date button). A profitable stock, and the
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
- **Moving averages.** 1W to 3M draw one grey average line labelled at
  its right end (5, 10 and 20 days). **6M** draws the 50-day in grey and,
  beside it, the 20-day in a muted grey-blue; **1Y** the 200-day in grey
  and the 50-day in the same grey-blue, each with its own label, so the
  two can be compared. Both start at the chart's left edge.
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

The portfolio's return against the S&P 500 over 1D (24H with extended
hours on), 1W, 1M, 3M or YTD. On 1W, 1M, 3M and YTD, and on 24H with
extended hours on, **both lines
start at 0 % at the left edge**, so the chart answers one question: how
did the two move against each other over this window. 1W is a real seven
days.

**1D (extended hours off) is the day's view.** It shows the latest
regular session of the US market (today's, from 9:30 in New York, while
it trades and after it closes; before the open and at the weekend, the
last one), and both lines are measured from the previous close: the
portfolio from what it was worth at the previous close, the S&P 500 from
its previous close. So the first point is not 0 %: it shows how far each
had moved overnight by the open. The portfolio line ends on the
scoreboard's DAY CHANGE % and the S&P line on the S&P 500 card in Market
Conditions, live while the market is open.

With extended hours on, the shortest button reads 24H: a trailing 24
hours, and 24H and 1W use
the S&P futures instead, and the title and legend say so. The futures
line then runs through the night, and the portfolio line follows the
overnight prices recorded from Trading 212 instead of staying flat;
holdings that don't trade overnight stay flat. That window starts at 0 %
and won't match DAY CHANGE. Hover to read both returns at that moment,
with its date or time.

On 1D and 24H, dashed lines mark the US market's OPEN (9:30 in New York, 14:30
UK time for most of the year) and CLOSE (16:00 in New York, 21:00 UK
time) with extended hours on; with them off, only the OPEN, at the left
edge, while the market is open. Each is drawn only when that moment
falls inside the window. Only the times the market traded are drawn, so
at the weekend the extended-hours window holds just the end of Friday's
session, the futures' last hour or so; with extended hours off it is
Friday's whole session. The faint vertical lines are the time axis's
gridlines, one under each time label.

### INVESTMENT

- **Value** is the portfolio in dollars. Its right-hand end is the
  scoreboard's PORTFOLIO figure.
- **Deposited** is the money paid in, net of sales, drawn as steps that
  move only on the day of a buy or a sale. Money in other currencies is
  converted at a rate fixed once and kept, not at today's rate, so the
  line moves only when money does.
- The legend gives each line's own move over the window, in percent.
  On 1D (extended hours off), Value's figure is measured from the
  portfolio's value at the previous close, so it reads the scoreboard's
  DAY CHANGE %; Deposited's is its move over the session, as before.
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
  Those windows rank only once every holding's price history for the
  window is there; until then the list reads "loading…" rather than
  ranking part of the book. On a return visit it draws from the
  history this device kept from the last one, so it is there at once.
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

The errors badge counts what someone has to look at, not every error
row. A passing hiccup — a timeout, an exchange or database answering 502
or "too many requests", or one failed run of a recorder whose next run
works — is kept in the record but left off the badge, unless it goes on:
the same job failing for 15 minutes in a row (three runs for a job that
runs every five or ten minutes) becomes one line, "failing since 08:48
UTC, 167 times", or "failed 08:48–11:34 UTC" once it has stopped. The
same message repeated is one line with its count. Always shown: the
monitor's alerts, code errors, a refused key or a missing setting, and
anything a live strategy says about its orders. The IG recorder reports
only when its weekend coverage is at risk: two failed runs in a row, or
any failure in the ten minutes from Sunday's open.

The errors badge also carries the production monitor's alerts. Every
minute it checks the live site, the database's minute loop and the live
stablecoin quotes. A check that has failed for two minutes running shows
as `monitor.alert`, named by the check (`site`, `loop` or `pr5`), and
`monitor.recovered` follows when it passes again. `monitor.deadman` means
the stablecoin quotes' executor stopped turning and every order it had
resting on the exchange was cancelled; it quotes again by itself when it
comes back. The same alerts open, or add to, a GitHub issue labelled
`monitor`. The executor watches the monitor in turn: when the dead-man
check has not run for five minutes, it quotes no new entries (its exits
and stops stay on) and the errors badge shows an `agents.quotes_live`
row beginning DEAD-MAN SWITCH NOT RUNNING, once; it quotes again by
itself once the monitor runs.

`agents.pm_rec` is the Polymarket recorder, which keeps the rewarded
markets' order books, reward terms and trades for research: a read it
could not make, an hour it could not archive, or one of its two calls
not running. It shows once, then at most hourly while the fault lasts.
Nothing on the page and no strategy reads the record, so it never stops
a strategy.

`trading212.upstream` means Trading 212 refused, or did not answer, the
board's read of its positions: the board keeps the shares it had, and the
row says what the broker answered. `trading212.isa` means only the ISA's
read failed: the board takes nothing from that answer as a sale. Each
shows once, then at most hourly while the fault lasts, and again at once
when it changes (a rate limit becoming an expired key, say).

`db.size` means the database has grown past 4 GB, once a day while it
stays there: what has served its test can be pruned or archived. Nothing
stops on it.

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
