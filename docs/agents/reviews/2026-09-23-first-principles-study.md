# Revolut X and Binance from first principles — where could this account earn money? (2026-09-23)

Davies asked for strategies unique to each venue, built from nothing: "这次不要给现有的策略，从0开始研究，从第一性原理出发按照逻辑一步步推导，发散性思维think out of box".
A research agent ran the programme on public data only (no keys, no signed calls, no orders) and wrote
everything below "The answer". This header says what was checked again before any of it was believed,
and where its files are. Reference §3.26 is the summary.

## What was re-computed, and what was not

**Re-computed (2026-09-23, 12:50–13:15 UTC):**

* **The four pre-registered tests reproduce byte for byte.** Each re-run produced the agent's JSON
  exactly (sha256 prefixes: PR1 `c9f28537…`, PR2 `f77ff9a5…`, PR3 `cdfec336…`, PR4 `05e6882b…`): once from
  the research folder, and once from the scripts committed here reading the inputs committed here (PR3,
  PR4) or the research folder's (PR1, PR2). Each pre-registration's sha256 matches its recorded hash, and
  each was frozen before its first result was written (PR1 11:09:20 → 11:13; PR2 11:10:17 → 11:19;
  PR3 11:37:49 → 11:39; PR4 11:44:24 → 11:44:54). PR3's script was read line by line: its fair value
  uses only closes before the minute, its exchange rate only a Yahoo bar that closed before it, its
  orders are live from the next minute, and a fill needs a traded minute whose close is strictly through.
  The headline numbers stand as the agent gives them.
* **Revolut X's UK 1-minute candles are built from quotes while nothing trades** — a fresh pull of the
  last 1,000 minutes (20:12 → 12:51 UTC) on the coins the loop trades: minutes with zero volume, and of
  those the share whose high differs from their low (median range): BTC/USD 64 % / 24 % (6.5 bps),
  ETH/USD 80 % / 45 % (9.7), SOL/USD 74 % / 31 % (10.0), XRP/USD 59 % / 19 % (17.6), AVAX/USD 96 % / 87 %
  (33.9), SUI/USD 92 % / 72 % (79.3), USDC/GBP 97 % / 89 % (6.7). The venue's own volume field says no
  trade happened in those minutes, and they move anyway.
* **The loop's maker probes read those minutes as fills.** All three probes on record
  (`agent_maker_probes` 1–3, trend-1h on Revolut X, 2026-09-22) were resolved as filled on a minute
  with ZERO volume: BTC/USD 04:00 (flat at the last print, which sat above the probe's ask), ETH/USD
  05:02 and SOL/USD 08:00 (both moved on quotes). The first trade through each price came at 04:07,
  05:42 and 08:06: 8, 43 and 7 minutes after the probe, not 1, 3 and 1. Fixed the same day
  (`tradedThrough` in agents/tick.ts; migration `0050` corrects the three rows and adds `fill_minute`).
* **The gap PR3 harvests is real and moves.** At 12:55 UTC, five snapshots 15 s apart: USDC/GBP implied
  +2.1 to +3.1 bps over Kraken's GBP/USD, USDT/GBP +0.0 to +1.0, BTC and ETH +0.6 to +1.6. The agent's
  live median two hours earlier was +11.8 on USDC/GBP. Consistent with its finding that the gap wanders
  and has shrunk all year; it is the reason a paper forward test, not money, is the next step.
* **The candles' volume is the trade tape, and a zero-volume minute has no trade.** The public tape
  (`GET /api/1.0/public/last-trades`) polled every 2 s for 12 whole minutes (12:58–13:10 UTC: 331 polls,
  none that came back all new, 4,278 prints) against the UK 1-minute candles of six GBP books, whose
  prints are UK-only: 47 minutes had zero volume, none of them a print, and 28 of them moved; 25 traded,
  every one with prints, its volume equal to theirs in 25, its close the last print in 23, and its high
  and low inside the prints' range in 22. The other three were stretched by quotes, which is why the
  loop's new fill test (`tradedThrough`) still leans optimistic, never the other way.

**Not re-computed:** every other number below is the agent's own measurement (the 31 ideas' arithmetic,
the live session's cycles and tape, the listings, the Binance comparisons), reported as it made it. The
research folder (≈1 GB, most of it Binance's 1-minute year) is not committed.

## Files

| here | what |
|---|---|
| `reviews/2026-09-23-first-principles-prereg-pr{1..4}-*.md` | the four pre-registrations, byte for byte (their own text calls them `prereg_*.md`) |
| `scripts/first_principles/` | the four tests and PR1/PR2's shared simulator (`quote_sim.py`); only the input path changed |
| `backtests/inputs/first_principles_2026-09-23/` | PR3 and PR4's inputs, gzipped: Revolut X UK 1-minute candles (USDC/GBP, USDT/GBP, USDC/USD, USDT/USD, BTC/USD, BTC/GBP) and Yahoo's GBP/USD minute closes. The venue keeps 1-minute candles 28 days, so these cannot be fetched again. |
| `backtests/first_principles/` | the results the text cites as `results/…`: PR2–PR4's JSON and the smaller analyses. PR1's (653 KB, void) is not committed; `FP_DATA` pointed at a folder with its hourly inputs regenerates it. |

---

## The answer

**Nothing venue-unique is worth real money yet. Two small edges pass pre-registered tests; one
of them is Revolut X's own.** I derived 31 ideas from what can pay a small UK spot account and
killed 25 with arithmetic; 3 need a signed call and 1 cannot be tested; the last 2 went to
pre-registered tests — four of them, because the first read candles that turned out to be quotes
and the fourth checks what the third found.

* **Revolut X's own edge — small, real on 13 days, not proven.** Its coin/GBP books sit on the
  interbank GBP/USD rate within about 1 bp (live medians +0.5 to +0.8 bps against Kraken); its
  USDC/GBP and USDT/GBP books do not (live, USDC-implied +11.8 bps median and up to +18.8; half of
  USDC/GBP's weekday volume in the last 28 days traded 10–25 bps under interbank). Resting quotes
  0.1–0.3 % either side of interbank on those two books, at 0 % maker, filled only when a print
  goes through them, made **+$4.68 on $1,200 in the 13-day out-of-sample half** (57 round trips,
  89 % won; random-time null 95th percentile +$0.87; doubled costs +$2.88; 190 orders a day).
  That is ≈ $0.35 a day, ≈ 11 %/yr on the capital it locks; $1,000 rungs make ≈ $2 a day at
  ≈ 6 %/yr, and the ceiling is a few dollars a day. Caveats: 13 days; I chose the distances after
  seeing where the volume traded; 22 of the 57 fills came in minutes that opened already through
  the quote (a post-only order might have been refused; without them the OOS result is +$3.59 on
  36 trips); and the gap has shrunk all year. The same rule on the USD stablecoin books, where no
  exchange rate is involved, traded 7 times (+$0.44) and fails the minimum-trade bar — so the edge
  is the GBP books' distance from interbank, not thin stablecoin books in general. In the live
  session after its data it opened one position on each book, confirmed by tape prints.
  **Worth a four-week paper test with fills read from the trade tape; not worth money yet.**
* **Binance's edge — real, and not worth running.** Resting quotes 0.25–2 % from the peg on
  Binance's long tail of USD stablecoins catch liquidation and fat-finger wicks. OOS **+$48.59 on
  $6,400 in 189 days** (null p95 −$25.79; doubled fees +$23.15; capacity-limited +$46.77). But that
  is ≈ 1.5 %/yr on the money it locks — below cash — spread across eight stablecoins, one of which
  failing would erase years of it.
* **The cross-currency arbitrage does not exist for this account.** The closed loop GBP → USDC →
  USD → coin → GBP was worth at most +18.5 bps before fees in two hours of live quotes (median
  +8.7); four taker legs cost 36 bps; 0 of 84 cycle variants was ever positive at taker prices.
* **A data finding that matters beyond this program:** Revolut X's UK candles are built from
  quotes when nothing trades. 61–98 % of 1-minute bars on the books studied carry zero volume and
  23–89 % of those still move (median range 2–25 bps); the trade tape shows no prints in them. Their
  high and low are not trade prices. My first pre-registered test "passed" on those wicks (+$688 on
  $3,200 over six months); with fills required from trades it collapses (beyond 0.5 % of fair, two
  traded minutes in 28 days). **That pass is void.** The loop in production reads the same
  candles the same way: `tick.ts` fills a resting paper order, and `probeFilled` marks a maker
  probe filled, when the last minute's `low <= price` (buy) or `high >= price` (sell), with no
  volume check — so paper resting fills and the maker probes (`0042`) are optimistic. Measured
  in the live session (4c): a probe at the touch reads "filled" within 5 minutes 93 % of the time
  on AVAX/USD by that test and 16 % by trades; on USDC/GBP 98 % against 0 % on the tape.
* **What the two venues do together is routing, not return:** Revolut X is the UK account's cheap
  GBP on-ramp and its only GBP books; Binance is the price reference and the breadth.

## 1. What can pay this account at all

A trade makes money only if someone accepts a worse price than fair, or pays for a risk
or a service. For a UK retail spot account with $100s–$1,000s, a loop that runs once a
minute, and resting orders that act in real time between turns, the candidates are:

| Source | Who pays | Necessary conditions | For this account |
|---|---|---|---|
| Risk premium (beta) | the market, over years | time; tolerance for drawdowns | not venue-specific; the benchmark, not an answer |
| Liquidity provision | impatient takers | fee ≤ captured half-spread; adverse selection < half-spread; queue access; order budget | Revolut X 0 % maker makes it free; a 60-s loop is the slowest quoter on any book |
| Information | slower traders | a forecast that beats costs | tested at length in reference §3.3–§3.25; off the table |
| Relative value (one asset, two prices) | whoever holds the stale price | the gap > the cost of closing the loop, often enough | the heart of the search: currencies, venues, forms, pegs |
| Carry / yield | issuers, protocols, banks | access to the product; capital idle anyway | Revolut X pays nothing in its API; Binance Earn unknown for UK |
| Fee structure / rebates | the venue | a pair with fee < spread | Revolut X 0 % maker; Binance 0.10 %, no known zero-fee pair |
| Rebalancing premium | variance drag of buy-and-hold | volatility, mean reversion, zero cost | ≈ ½σ²w(1−w) ≈ 2.5–3 %/yr at σ 45–50 %, drowned by the beta it carries |
| Tax (UK CGT) | HMRC's rules | gains above the £3,000 allowance | irrelevant at this size |

Two facts shape everything below. **A resting order is the only way a once-a-minute loop
can act inside a minute**: it is an option the market exercises in real time. So every
edge this account can reach is either a resting order that someone else trades against,
or a taker order large enough in edge to survive 9–10 bps. And **the order budget is
1,000 placements a day on Revolut X** — 0.69 a minute for everything the account does.

## 2. What each venue's structure makes available

**Revolut X (UK book)**
* 0 % maker, 0.09 % taker, flat. The only fee-free resting venue this account has.
* 1,000 order placements a day (sustained), public data 1 request a second.
* Books: 393 UK pairs — USD 306, GBP 64, USDC 23 (no EUR in the UK region). 64 coins have
  both a GBP and a USD book. Four stablecoin books: USDC/USD, USDT/USD, USDC/GBP, USDT/GBP
  (opened 2025-11-26 and 2025-12-16).
* Who trades: UK retail (the GBP books), a few market makers with large single orders
  (BTC/USD shows $3M within 0.1 % of mid in a book that trades $5M a day).
* Publishes an `index_price` per pair — a free fair value (the stable-book index implied
  Kraken's GBP/USD within 0.53 bps median; the USDC/GBP book itself sat 8.6 bps under it).
* Candles are quote-built between trades (section 4c). History: 1 hour back a year;
  1–30 minutes back only 28 days (measured: every interval below 60 returns nothing
  before 2026-08-26).

**Binance (spot, UK retail)**
* 0.10 % maker and taker (0.075 % with BNB). No GBP: all 23 GBP pairs are in `BREAK`.
  EUR pairs trade; so do USD pairs (`USDCUSD`, `BTCUSD`…) in permission groups a UK
  account may not have.
* The deepest books there are (BTC 0.001 bps, ETH 0.04 bps wide) and the price leader:
  Revolut X's 1-minute returns correlate 0.25–0.27 with Binance's previous minute, the
  reverse ≈ 0.
* Breadth: 493 USDT pairs, and a long tail of USD stablecoins against USDT (USDC, FDUSD,
  TUSD, USDP, USD1, XUSD, BFUSD, USDE, RLUSD, USDS, U) whose books go thin.
* Liquid staking and wrapped forms on spot (WBETH, BNSOL, WBTC), gold (PAXG, XAUT).
* Trade-built klines (every zero-volume minute is flat — checked on 4 pairs, 2.2M bars).

**What only one venue makes available.** Revolut X: free resting orders; GBP books;
stablecoin/GBP books that are not arbitraged to interbank. Binance: a reference price;
a long tail of pegged assets; forms (LSTs, wrapped).

**What only the combination makes available.** (1) Make on Revolut X at 0 %, anchor or
hedge on Binance. (2) Buy on one, sell on the other, rebalance by transfer. (3) Route
currency: GBP enters through Revolut X (Binance has no GBP rail for UK retail), dollars
and breadth live on Binance. (4) Use Binance's clean price to judge Revolut X's books.

## 3. Thirty-one ideas, and the arithmetic that decides them

Units: bps of notional; $ figures for a $1,000 account unless stated. "Measured" points to
section 4.

### Liquidity provision

1. **Quote the touch on Revolut X majors at 0 %.** Half-spread earned 0.5–0.9 bps (BTC 1.6,
   ETH 1.8 bps wide, measured). A quote that cannot move for 60 s is hit after the price
   moves: 1-minute σ is 4.9 bps (BTC) to 9.8 (XRP) on Binance. Expected adverse selection
   per fill ≈ 0.4σ ≈ 2–4 bps > 0.9. And two quotes refreshed each minute need 2,880
   placements a day against 1,000. **Dead.**
2. **Quote on Binance.** 10 bps maker fee against 0.001–1 bp spreads. **Dead** by 10–10,000×.
3. **Deep quotes on Revolut X coin books anchored to Binance** (a bid k below Binance,
   waiting for a UK-only sweep). Order budget: keeping a quote k from a moving anchor means
   re-quoting on moves of about k/3; the time between re-quotes is ≈ (k/3 ÷ σ₁ₘ)² minutes:
   BTC at k = 30 bps → every 4 minutes → 360 a day per side; four coins, two sides → 2,880.
   Only k ≥ 60 bps fits the budget. Fills: minutes that traded AND whose (partly quote-built)
   range went 30 bps beyond Binance's same-minute range numbered 4–46 per coin in 28 days
   (4c), carrying $5k–$283k per coin in total; a $100 quote catching every one of them at
   30 bps earns about $9 a month on the busiest coin. **Dead** — cents a day.
4. **Make on Revolut X, hedge on Binance.** Break-even distance = 10 bps fee + Binance
   half-spread (0–2 bps) + the move before the next turn (≈ 0.5σ₁ₘ: 2.5–5 bps) ≈ 13–17 bps
   on the majors, before transfer costs to rebalance two inventories. Revolut X sits 15+ bps
   from Binance in 0.3–3 % of traded minutes on the majors (4b), mostly quote-built.
   **Dead** (same arithmetic as 3, plus 10 bps).
5. **Stablecoin peg ping-pong on Revolut X** (bid 0.9999 / ask 1.0000 on USDC/USD). 1 bp per
   round trip on a book that trades $22k a day; a 25 % share is $0.28 a day, and a
   strictly-through fill at 1.0000 needs a print at 1.0001. **Dead** by capacity.
6. **Wick-catching quotes on Revolut X's stablecoin books** (fair = peg, or peg ÷ GBP/USD).
   Survived the arithmetic, pre-registered as PR1 — **void**: the wicks are quotes (4c, 5). Its
   trade-verified successor, tight quotes on the two GBP books, is PR3 — **passes, small** (5).
7. **Wick-catching quotes on Binance's stablecoin tail.** Survived, pre-registered as PR2 —
   **passes the bar, fails the economics** (5).
8. **Grid / rebalancing on a coin at 0 % maker.** The premium over buy-and-hold is
   ≈ ½σ²w(1−w): 2.5–3 %/yr at σ 45–50 % and w = ½, against ≈ 25 %/yr of σ from the
   inventory — a Sharpe of ≈ 0.12, which one year cannot tell from zero (t = 2 needs ~280
   years). It is also §3.23's machinery. **Dead** as a testable edge.
9. **Pair rebalancing BTC/ETH.** Ratio σ ≈ 30–40 %: premium ≈ 1–2 %/yr under the same beta.
   **Dead.**

### Relative value — one asset, two prices

10. **Revolut X internal cycle GBP → USDC → USD → coin → GBP** (and reverse). Measured live
    (4a): the best cycle at the touch was +18.5 bps before fees (median +8.7); four taker legs
    cost 36 bps; 0 of 84 variants was ever positive at taker. **Dead.**
11. **The same with resting legs.** Stable legs resting + coin legs taking: positive only
    where a "resting" leg sits on a 20–47 bps-wide book (NEAR, SUI, BCH, ATOM) — the spread you
    would earn if someone filled you, not an arbitrage. Coin legs resting: an unhedged coin
    position between fills, σ ≈ 5–10 bps a minute against a 2–12 bps gap. **Dead.**
12. **Stable-only triangle USDC/GBP ↔ USDT/GBP via the USD books.** Live gap median ≈ 11.7 bps
    (USDC-implied +11.8 vs USDT-implied +0.15 bps from Kraken's rate), four legs at 36 bps.
    **Dead.**
13. **Coin-implied rates against each other (BTC-implied vs ETH-implied GBP/USD).** Medians
    within 0.6 bps of each other, p05/p95 within ±2.1 bps on the majors (4a). **Dead.**
14. **One taker leg into a stale stable/GBP book, exit resting.** Needs |dev| × (share the
    book closes) > 9 bps + 0.7 bps half-spread. At 1 minute the deviation's p05/p95 is
    −14/+8 bps (USDC) and −14/+13 (USDT) with a 1.8–2.4-minute half-life, and the book
    closes about half: ≈ 7 bps expected at the 5 % tail. **Dead.**
15. **Revolut X vs Binance inventory arbitrage** (sell where rich, buy where cheap, rebalance
    by transfer). Hurdle ≈ 9 (or 0) + 10 bps + spreads + transfers; Revolut X closes half
    the basis within a minute by itself, Binance does not move (4b). |basis| > 20 bps in
    0.3–3 % of traded minutes on majors (quote-built). **Dead.**
16. **Stablecoin triangle across venues** (Binance USDCUSDT vs Revolut X USDC/USD and
    USDT/USD). Revolut X implies USDC/USDT ≈ 1.0002–1.0005; Binance's book is 0.1 bps wide
    around the same; gap 1–3 bps against 10 bps and a transfer. **Dead.**
17. **PAXG vs XAUT on Revolut X.** Both books 9–12 bps wide; $5k–$16k a day; live gap ≈ 1–5
    bps. **Dead.**
18. **Liquid staking tokens (WBETH, BNSOL; MSOL on Revolut X).** Accrual 2.5–7 %/yr = 1–6 bps
    over the live row's 0.6–3.4-day holds, less than one conversion; MSOL/USD on Revolut X is
    133 bps wide with $64 a day. **Dead** for trading (a holding form for long-term coins only).
19. **Wrapped BTC (WBTC/BTC) on Binance.** Peg ± a tick, 10 bps a side. **Dead.**
20. **Revolut X UK vs EEA books.** The account can trade only the UK book. **Dead.**
21. **Revolut app vs Revolut X prices.** Not reachable by API. **Dead.**
22. **Weekend FX (GBP books while FX is shut).** Stable/GBP deviation weekday vs weekend:
    median −1.6 vs −2.8 bps, mean |dev| 5.5 vs 5.4 (28 days, 1 m); hourly year: 10.6 vs
    12.8. No weekend premium to take. **Dead.**
23. **New listings on Revolut X at a UK premium.** 44 listings in the year that Binance already
    had: median day-0–7 premium 0.00 %, 95 % within −0.23/+0.38 % (4c). Nothing to sell into, and
    it would need the coin pre-positioned by manual transfer. **Dead.**

### Carry, fees, flows, other

24. **Interest on idle cash.** Revolut X pays none in its API; Revolut's savings pot is
    outside X and manual. At $1,000 with half idle, 4 % is $20 a year. **Dead** for the loop.
25. **Binance Simple Earn on idle USDT/USDC.** UK eligibility and the rate need a signed call.
    **Unmeasured** (section 7).
26. **BNB airdrops / Launchpool.** UK eligibility unknown; not in the public API.
    **Unmeasured.**
27. **BNB fee discount** (10 → 7.5 bps). A cost cut, not an edge.
28. **Zero-fee Binance pairs** (FDUSD/USDC/U promotions in the past). Per-symbol commission
    needs a signed call. **Unmeasured.**
29. **Scheduled retail flow on Revolut X** (recurring buys at fixed times). The top five
    minutes of the day hold 3–11 % of 28 days' volume (uniform 0.35 %) but on only 7–25 of
    28 days, and 12:30 UTC — US data releases — leads on three books. Lumpy trades and
    macro news, not a schedule. **Dead** (4c).
30. **Stablecoin de-peg lottery** (bids 5–10 % under the peg). The deep end of 6/7; a real
    failure (UST, May 2022: 0.2) is not in any window; its expected value is a belief about
    issuers, not a measurement. **Not testable.**
31. **Tax.** UK CGT allowance and matching rules — planning, not trading.

## 4. Measurements (public data, 2026-09-23)

### 4a. Revolut X cross-currency structure

*Live, bid/ask, one snapshot a minute (10:41–12:42 UTC, 122 snapshots; Kraken
GBP/USD mid as reference):*

| live measure (bps) | median | p05 / p95 |
|---|---|---|
| BTC-implied GBP/USD − Kraken GBP/USD mid | +0.54 | −0.41 / +1.73 |
| ETH-implied GBP/USD − Kraken GBP/USD mid | +0.79 | −0.53 / +1.99 |
| XRP-implied GBP/USD − Kraken GBP/USD mid | +0.64 | −0.63 / +1.68 |
| SOL-implied GBP/USD − Kraken GBP/USD mid | +0.65 | −0.66 / +2.11 |
| all 21 coin-implied rates (medians; p05/p95 without NEAR, SUI) | +0.20 to +0.79 | −2.37 / +3.76 |
| USDC/GBP-implied (mids) − Kraken | +11.82 | +2.30 / +18.75 |
| USDT/GBP-implied (mids) − Kraken | +0.15 | −1.89 / +5.32 |
| Revolut X index-implied (USDC books) − Kraken | +0.53 | −0.30 / +1.66 |
| USDC/GBP book mid − its own index | −8.59 | −14.62 / +1.39 |
| USDT/GBP book mid − its own index | +2.39 | −2.89 / +3.85 |
| cycle USDC BTC A at the touch, before fees / after 4 × 9 bps | +8.72 / −27.26 | max +18.48 / −17.54 |
| cycle USDC ETH A at the touch, before fees / after 4 × 9 bps | +7.47 / −28.50 | max +17.27 / −18.74 |
| cycle USDT BTC A at the touch, before fees / after 4 × 9 bps | −5.83 / −41.76 | max +4.41 / −31.56 |
| cycle USDC BTC B at the touch, before fees / after 4 × 9 bps | −14.44 / −50.34 | max −5.04 / −40.97 |
| cycle variants ever positive after taker fees | 0 of 84 | best −16.54 |
| persistence of cycle A (USDC, BTC) at the touch, minute to minute | lag-1 autocorrelation 0.92 | half-life ≈ 9 min |

Cycle A = GBP → stablecoin → USD → coin → GBP; B = the reverse. 84 variants = 2 stablecoins × 21
coins × 2 directions, each at the touch (`results/a_live_cycles.json` also prices them with the
stablecoin legs or the coin legs resting at 0 %: those are upper bounds that assume someone fills
the resting leg, and are positive only where that leg sits on a 20–47 bps-wide book).

*One year, hourly closes (UK; coin books from 2025-09-11, stable books from their opening):*

| | median | IQR | p05 / p95 | share of hours beyond 20 bps | AR(1) half-life |
|---|---|---|---|---|---|
| BTC-implied GBP/USD − Yahoo interbank | −0.26 bps | MAD 2.4 | −9.7 / +9.1 | — | — |
| ETH, XRP, SOL-implied − Yahoo | −0.2 to −0.8 | MAD 3–4 | ±13–17 | — | — |
| USDC/GBP book vs BTC-implied rate | −3.1 | −12.1 / +4.3 | −26 / +19 | 15.6 % | 0.6 h |
| USDT/GBP book vs BTC-implied rate | +0.6 | −12.4 / +14.2 | −32 / +33 | 32.5 % | 0.9 h |

The stable/GBP books close 41–62 % of a gap themselves within 1–24 hours; the FX rate
closes 12–25 % (partly measurement noise). The gap shrank all year: mean |dev| on USDC/GBP
22 bps in 2025-11, 13–14 in spring, 7.6 in August, 4.9 in September; USDT/GBP 18.7 → 5.8.

*Last 28 days, 1-minute closes:* USDC/GBP median −2.0 bps, IQR −6.1/+1.5, p05/p95
−14.4/+8.3, beyond 20 bps in 1.8 % of minutes, half-life 1.8 min; USDT/GBP median +0.5,
IQR −3.7/+4.7, p05/p95 −13.8/+12.8, beyond 20 bps 3.4 %, half-life 2.4 min. No weekend
effect; slightly larger 13–16 UTC.

**Why it exists, and why it cannot be taken.** Market makers arbitrage the coin/GBP books
against global coin prices and interbank FX, so every coin implies the interbank rate. No one
arbitrages the stablecoin/GBP books to interbank as tightly, because doing so needs cheap
GBP↔USD conversion outside the book. This account's cheapest GBP↔USD conversion is… the coin
books, at 18 bps for two taker legs. The gap is smaller than the cost of closing it as an
arbitrage. What can be harvested is the gap itself, by resting on both sides of interbank and
letting the book come back — PR3.

### 4b. Revolut X vs Binance, 1 minute, 28 days (2026-08-26 → 2026-09-23)

Revolut X UK USD book close vs Binance USDT close ÷ USDCUSDT, minutes in which Revolut X
traded; live touch spreads: medians of 122 one-minute snapshots, 10:41–12:42 UTC.

| coin | RevX minutes traded | \|basis\| p50 / p95 / p99 / max (bps) | beyond 20 bps | corr(RevX t, Binance t−1) | RevX closes basis next min | spread RevX / Binance (bps) |
|---|---|---|---|---|---|---|
| BTC | 24.9 % | 1.7 / 8.0 / 13.8 / 58.5 | 0.28 % | 0.26 | 51 % | 1.67 / 0.001 |
| ETH | 18.5 % | 2.6 / 11.9 / 20.5 / 44.8 | 1.1 % | 0.25 | 48 % | 1.98 / 0.04 |
| SOL | 23.5 % | 3.2 / 13.2 / 22.6 / 272 | 1.5 % | 0.25 | 54 % | 3.17 / 0.85 |
| XRP | 22.2 % | 3.8 / 16.9 / 27.8 / 81 | 3.2 % | 0.27 | 52 % | 5.05 / 0.64 |
| AVAX | 3.7 % | 6.2 / 27.4 / 50.5 / 503 | 10.1 % | 0.12 | 13 % | 9.90 / 0.90 |
| LINK | 7.2 % | 5.0 / 18.6 / 32.9 / 67 | 4.0 % | 0.13 | 23 % | 7.84 / 0.78 |
| DOGE | 4.7 % | 4.7 / 23.8 / 41.2 / 450 | 7.6 % | 0.12 | 14 % | 8.03 / 1.00 |
| ADA | 4.1 % | 6.0 / 22.7 / 35.5 / 424 | 6.7 % | 0.08 | 58 % | 8.40 / 3.99 |

Binance leads by up to two minutes (lag-2 correlation 0.09–0.11); Binance never moves toward
Revolut X (slope ≈ 0). What "make on Revolut X at 0 %, hedge on Binance at 10 bps" needs per
coin: a resting quote ≥ 10 bps + Binance half-spread + ≈ 0.5σ₁ₘ from Binance — ≈ 13 bps on
BTC, 14 ETH, 15 SOL, 16 XRP, 16–17 on the alts — hit by genuine trades often enough to pay for
the order budget and the transfers that rebalance two inventories. At $100 a quote and 10 bps
kept per fill, $1 a day needs 10 genuine fills a day per coin. The candles offer 0.1–1.5 traded
minutes a day beyond 20–30 bps of Binance on the majors (section 4c), some of them
quote-extended, and the trade tape found no UK print more than 3.3 bps outside Binance's range in
1.5 hours. The loop would also spend its whole order budget keeping four coins' quotes in place.

### 4c. Other decisive measurements

* **Candle construction (the finding that voided PR1).** Revolut X's public trade tape
  (`GET /api/1.0/public/last-trades`, 100 prints a call, polled every ~4 s) against the UK 1-minute
  candles of the six GBP books studied (GBP prints are UK-only), 11:15–12:42 UTC: in the 190
  minutes with prints, the candle's volume equals the prints' volume in 184, its close is the last
  print in 179, and its high/low stay inside the prints' range in 167 — the other 23 are stretched
  by quotes (8 of the 10 on USDT/GBP). No minute without prints carries candle volume, yet 132 such
  minutes moved. So a traded minute's volume and close are trades; its high and low are not always;
  a zero-volume bar is quotes.
* **Zero-volume bars that move**, last 28 days, 1 minute: share of bars with zero volume and,
  of those, the share whose OHLC still moves (median range): USDC/GBP 97 % / 89 % (8.0 bps),
  USDT/GBP 93 % / 76 % (5.4), USDC/USD 98 % / 80 % (2.0), USDT/USD 97 % / 83 % (3.0),
  BTC/USD 75 % / 41 % (6.1), BTC/GBP 61 % / 25 % (7.6), ETH/USD 81 % / 53 % (9.2),
  XRP/USD 78 % / 48 % (12.9), AVAX/USD 96 % / 88 % (24.6), DOGE/USD 95 % / 85 % (15.5).
  Binance's klines never move on zero volume (0 of 1.31M zero-volume bars on four pairs).
* **Where the stable-book wicks came from** (28 days, PR1's fair value): minutes beyond 0.5 %
  of fair — USDC/GBP 51 with zero volume, 1 with volume; USDT/GBP 12 and 0; USDC/USD 6 and 1;
  USDT/USD 0 and 0. Beyond 1 %: 20 and 0 (USDC/GBP). Beyond 2 %: 5 and 0.
* **Coin candles beyond Binance's same-minute range** (28 days; minutes with zero / with
  volume): at 30 bps BTC 67/6, ETH 90/7, SOL 111/4, XRP 458/30, AVAX 900/39, LINK 614/29,
  DOGE 556/29, ADA 876/26, HBAR 1,244/46.
* **The trade tape** (11:15–12:42 UTC, 27,428 prints; 2 polls came back all-new, i.e. may have
  missed prints). USDC/GBP: 5 prints (£9,953), every one 14–20 bps under interbank (median −17):
  3 buyers lifting the cheap ask, 2 sellers hitting an even cheaper bid. USDT/GBP: 13 prints
  (£19,807), −9.5 to +2.7 bps (median −3.8): 7 sells at the bid, 5 buys at the ask. Coin GBP books
  (BTC 124 prints, £147k; ETH 93, £357k; XRP 97, £228k; SOL 77, £85k): no print outside Binance's
  same-minute range by more than 3.3 bps — the UK-only dislocation that ideas 3–4 need never printed.
* **The loop's own fill test on these candles** (`results/c_probe_bias.json`). A probe at the touch
  was opened every minute of the live session and followed three ways: `tick.ts`'s test (any
  candle with low ≤ price / high ≥ price), a trade test (volume > 0 and strictly through), and on
  the GBP books the tape. Filled within 5 minutes — AVAX/USD 93 % vs 16 %; USDC/GBP 98 % vs 1.7 %
  (tape 0 %); USDT/GBP 96 % vs 23 % (tape 14 %); BTC/USD 71 % vs 50 %; ETH/USD 73 % vs 41 %;
  BTC/GBP 69 % vs 62 % (tape 62 %). Within 1 minute: AVAX/USD 78 % vs 4 %, USDC/GBP 90 % vs 0 %,
  BTC/USD 47 % vs 17 %. On the coin GBP books the trade test and the tape agree within 1–4 points, so
  "volume > 0 and strictly through" is a fair proxy there; on the stablecoin books even that
  overstates, and only the close of a traded minute or the tape is safe. The maker probes (`0042`)
  record the production number.
* **Binance stablecoin wicks, in-sample half only** (1 minute, events merged within an hour;
  k = 0.5 % / 1 %): USDC 2 / 1, FDUSD 4 / 3, TUSD 14 / 2, USDP 7 / 3, USD1 4 / 4, XUSD 7 / 2,
  BFUSD 0 / 0, USDE 4 / 2 — about 33 events a year at 1 % across eight pairs, with
  $0.1k–$40M of volume in the first through-minute.
* **Scheduled flow**: see idea 29.
* **Listings** (`results/c_listings.json`): 90 UK pairs began trading during the year; 44 were
  already on Binance. Each Revolut X daily close (London midnight) against Binance's close at the
  same instant, days 0–7: median premium 0.00 %, 95 % of 212 day-pairs within −0.23 % / +0.38 %,
  day 0 above +1 % in 2 of 44. The two big numbers are AI (+41 % to +66 % on every one of 8 days —
  a premium that never closes is two different tokens under one ticker, or a book no one can
  arbitrage) and SENT on day 0 (+4.3 %, then 0.0). No listing premium to sell into.
* **Revolut X history depth**: 1 h and 4 h candles to 2025-09-11; 1, 5, 15 and 30 minutes
  only to 2026-08-26.

## 5. The pre-registered tests

All four were written and frozen (sha256 + UTC time) before any return of their rule was
computed, and each produced byte-identical JSON in two runs and in a third at the end
(`results/rerun_check/`).

| test | books | data | OOS | OOS P&L on capital | null p95 | stress | verdict |
|---|---|---|---|---|---|---|---|
| PR1 | Revolut X USDC/USD, USDT/USD, USDC/GBP, USDT/GBP | 1 h, a year | 189 d | +$688.32 on $3,200 | +$4.11 | +$612.23 | **void** — the candles' highs and lows are quotes |
| PR2 | Binance: 8 USD stablecoins vs USDT | 1 m, a year | 189 d | +$48.59 on $6,400 | −$25.79 | +$23.15 | **passes**; ≈ 1.5 %/yr, below cash |
| PR3 | Revolut X USDC/GBP, USDT/GBP | 1 m, 28 d, fills proven by prints | 13.25 d | +$4.68 on $1,200 | +$0.87 | +$2.88 | **passes**; ≈ $0.35/day; forward-test it |
| PR4 | Revolut X USDC/USD, USDT/USD | as PR3 | 13.25 d | +$0.44 on $1,200 (7 trips) | +$0.09 | +$0.10 | **fails** (< 20 round trips) |

### PR1 — resting quotes around fair on Revolut X's four stablecoin books — VOID

`2026-09-23-first-principles-prereg-pr1-revx-stable-quotes.md` (frozen 2026-09-23T11:09:20Z, sha256 067a0061…);
`scripts/first_principles/pr1_revx_stable_quotes.py` → `results/pr1_run{1,2}.json` (sha256 c9f28537…, identical; not committed).
Hourly year test; IS = the books' opening → 2026-03-18, OOS = 2026-03-18 → 2026-09-23.
Rungs 0.25/0.5/1/2 % a side, $100 each ($3,200), exits resting at fair, 24-hour taker stop.

As registered it passed all four conditions: OOS **+$688.32** (2,503 round trips, 93 % won),
null p95 +$4.11, stress +$612.23, capacity-limited +$506.93. **I do not believe it**, for a
reason found after the freeze by the descriptive 1-minute arm the pre-registration asked for:
over the last 28 days the hourly engine booked 158 trips and +$41.76; the same rule evaluated
minute by minute, filling only in minutes that traded, booked 59 trips and +$7.73, and beyond
0.5 % of fair there were two traded minutes in 28 days (one on USDC/GBP, one on USDC/USD). The hourly bars' highs and lows are
mostly quotes (4c), so the test measured how far quotes wander, not whether anyone traded
there. The registered fill model ("the market trades strictly through") cannot be evaluated on
these candles, and no public source holds Revolut X's trade history. What would settle it:
the signed `GET /api/1.0/trades/all/{symbol}` over the year, or a forward test whose fills come
from the trade tape (the maker probes read the same candles and would repeat the error).

(The descriptive arm first had a defect: it recomputed fair from 1-minute closes with a
60-traded-minute floor, which left the USDC books without a fair most hours and produced 2 trips.
I replaced it with the rule's own hourly fair; the registered arms' code and numbers did not
change.)

### PR2 — resting quotes around the peg on Binance's stablecoin tail — PASSES, NOT WORTH RUNNING

`2026-09-23-first-principles-prereg-pr2-binance-stable-quotes.md` (frozen 2026-09-23T11:10:17Z, sha256 10d54246…);
`scripts/first_principles/pr2_binance_stable_quotes.py` → `results/pr2_run{1,2}.json` (sha256 f77ff9a5…, identical).
1-minute year test, same split, eight USDT-quoted stablecoins, rungs 0.25/0.5/1/2 %, $100 each
($6,400), 0.10 % a fill, exits resting at fair, 24-hour taker stop.

| arm | IS (188 d) | OOS (189 d) |
|---|---|---|
| primary | +$41.82, 140 trips | **+$48.59**, 127 trips, 94 % won, worst −$0.25, max DD $0.25 |
| stress (0.20 % fees, full spread) | +$13.78 | **+$23.15** |
| capacity (fill ≤ 10 % of the minute's volume) | +$40.90 | **+$46.77** |
| random-time null (2,000 draws) | | mean −$26.68, p95 **−$25.79**; no draw reached +$48.59 |

All four conditions hold. By rung (OOS): 0.25 % +$1.63 on 63 trips (the fee eats it), 0.5 %
+$9.01, 1 % +$16.60, 2 % +$21.35 on 12 trips. By pair: USDP +$21.40, USDE +$12.90, XUSD
+$6.90, USDC +$4.30, TUSD +$3.07, BFUSD +$0.02, FDUSD and USD1 no OOS trips. Orders: 11.8 a day.

**Why it is not worth running.** 0.76 % in 189 days on the capital the resting orders lock is
≈ 1.5 % a year — below cash. Bigger rungs do not help: with fills capped at 10 % of each
minute's volume the return on locked capital falls (0.73 % → 0.60 % → 0.41 % → 0.23 % per
189 days at $100 / $1k / $10k / $100k rungs; `results/pr2_capacity_curve.json`). It needs
$400 of each of eight stablecoins held on Binance (TUSD, USDP, XUSD, USDE, USD1, BFUSD…), and
the loss it does not show — one issuer that does not come back — would take years of income:
USDE at its October 2025 low (0.65) would cost the $800 of USDE rungs about $280. Whether a UK
account may hold or trade each of these on Binance is unknown without a signed call.

### PR3 — quoting Revolut X's USDC/GBP and USDT/GBP around interbank, fills proven by trades — PASSES, SMALL

`2026-09-23-first-principles-prereg-pr3-revx-gbp-stable-touch.md` (frozen 2026-09-23T11:37:49Z, sha256 0f0f1ef1…);
`scripts/first_principles/pr3_revx_gbp_stable_touch.py` → `results/pr3_run{1,2}.json` (sha256 cdfec336…, identical).
Written after PR1's candles turned out to be quotes. The 28 days of 1-minute candles split in half
(IS 2026-08-26 → 09-09 18:00, OOS → 09-23). Fair = the USD book's 24-hour median ÷ Yahoo's interbank
GBP/USD (no FX print within 10 minutes → no quotes, so weekends are dark; Yahoo's 1-minute file
starts 2026-08-30 23:00, so the IS half quotes from 08-31). Rungs 0.1/0.2/0.3 % a
side on both books, $100 each ($1,200). A fill needs a traded minute whose CLOSE — its last print,
checked against the tape — is strictly through the quote, and is at most 10 % of that minute's
volume. Exits rest at fair; 24-hour taker stop. Orders live the minute after the loop places them.

| arm | IS (14.75 d) | OOS (13.25 d) |
|---|---|---|
| primary | +$4.45, 43 trips | **+$4.68**, 57 trips, 89 % won, worst −$0.12, max DD $0.18, no taker exit |
| stress (18 bps + full spread; one more tick through) | +$4.33 | **+$2.88**, 41 trips |
| random-time null (2,000 draws) | | mean +$0.10, p95 **+$0.87**; no draw reached +$4.68 |
| BTC-implied FX instead of Yahoo (descriptive) | +$3.84 | +$2.18, 99 trips — but 4,150 orders a day: the in-venue rate is too noisy to quote from |
| full $100 fills (descriptive) | +$5.36 | +$7.05 |

All four conditions hold (190 orders a day). OOS by book: USDT/GBP +$3.45 (38 trips), USDC/GBP
+$1.23 (19). By rung: 0.1 % +$2.69 (42), 0.2 % +$0.97 (10), 0.3 % +$1.02 (5). Bids 36, asks 21.
Median holding 73 minutes.

**How much it is, and how much to trust it.** $0.35 a day on $1,200 — ≈ 11 %/yr on the locked
capital, about 3× what the same $1,200 earns in cash (~4 %), about $130 a year. Larger rungs, still
capped at 10 % of each minute's volume (`results/pr3_capacity_curve.json`): $300 → $0.84 a day
(8.5 %/yr), $1,000 → $2.03 (6.2 %), $3,000 → $4.24 (4.3 %). The ceiling is a few dollars a day.
Against it: 13 OOS days is a short record; the distances were chosen after I had seen where the 28
days' volume traded (disclosed in the pre-registration); in 22 of the 57 OOS fills the minute
OPENED already through the quote, so a post-only order might have been refused or joined the queue
at a better price instead (those 22 made +$1.38, the other 35 +$3.30; re-simulated with no fill
allowed in a minute that opened through the quote, OOS is +$3.59 on 36 trips,
`results/pr3_variant_no_open_through.json`); and the effect it harvests shrank all year (hourly
mean |dev| on USDC/GBP 22 bps in November, 5 bps in September).

**Forward check** (`results/pr3_forward_check.json`): the rule, unchanged, on the live session that
came after its data (11:15–12:42 UTC). It opened one position on each book — a USDC/GBP bid at 0.7521
and a USDT/GBP ask at 0.7535 — each confirmed identically by the candle close and by tape prints, and
both were still open when the session ended. Consistent with ~4 fills a day; too short to say more.

**What would settle it:** the same rule in paper in the loop for four weeks, with fair from Revolut
X's own `index_price` (it tracked interbank within 0.53 bps) and fills read from the public trade
tape (`GET /api/1.0/public/last-trades`; GBP prints are UK-only, and polled every ~4 s it missed
little in this session — 2 polls may have missed prints), not from candles.

### PR4 — the same rule on Revolut X's USDC/USD and USDT/USD books — FAILS (too few trades)

`2026-09-23-first-principles-prereg-pr4-revx-usd-stable-touch.md` (frozen 2026-09-23T11:44:24Z, sha256 407d3288…);
`scripts/first_principles/pr4_revx_usd_stable_touch.py` → `results/pr4_run{1,2}.json` (sha256 05e6882b…, identical).
Registered after PR3 to ask whether PR3 is about stablecoin books in general or about the GBP books.
Fair = each book's own 24-hour median; nothing else changed. OOS **+$0.44 on 7 round trips**
(USDT/USD all of them; USDC/USD none), null p95 +$0.09, stress +$0.10 — positive, and it fails the
bar's minimum of 20 round trips (2.7 orders a day; the USD books sit on the peg). So PR3's edge is
the GBP books' distance from interbank, not a property of thin stablecoin books.

## 6. What a combination of the two venues looks like

Nothing to put money on today. What the evidence supports:

1. **One forward test, on Revolut X alone** — PR3's rule in paper for four weeks: resting quotes
   0.1–0.3 % around interbank on USDC/GBP and USDT/GBP, fair from Revolut X's `index_price`, fills
   only from prints on the public trade tape, 190 orders a day. It is the only mechanism found
   that is unique to a venue this account uses, and it would need ≈ $1,000–$3,000 of GBP, USDC and
   USDT working capital to be worth $1–4 a day if the record holds.
2. **GBP in through Revolut X.** Binance has no GBP book for UK retail. The cheapest GBP → dollar
   path this account has is a resting bid on Revolut X's USDC/GBP or USDT/GBP book — during the
   live session USDC was 2–19 bps cheaper there than interbank (median 12) — then USDC/USD at
   0.9999–1.0000, or the
   stablecoin sent to Binance. A one-off saving on funding, not a schedule.
3. **Binance as the reference, Revolut X's index as the free substitute.** One public request
   returns a fair value for all 393 UK books; the stable-book index implied Kraken's GBP/USD
   within 0.53 bps (median). Use it to mark, and to see when a Revolut X book is stale.
4. **Read Revolut X candles as quotes.** For fills use volume and the last print (the close of a
   traded minute), or the trade tape — in backtests, in paper, and in the maker probes.

## 7. What could not be measured without keys

| Question | Signed endpoint that settles it |
|---|---|
| Did Revolut X's stable books trade 0.1–2 % from fair over the whole year, and at which side? (PR1, and PR3 on more than 28 days) | `GET /api/1.0/trades/all/{symbol}` (Revolut X, market trades, ≤ 1-week windows) for USDC-GBP, USDT-GBP, USDC-USD, USDT-USD |
| Does Revolut X serve 1-minute candles older than 28 days to a key? | `GET /api/1.0/candles/{symbol}?interval=1&since=…&until=…` |
| Is the 1,000-a-day order cap per sub-account? | a second sub-account key, `POST /api/1.0/orders` rate-limit headers |
| Which Binance trading groups the UK account has (`USDCUSD`, `BTCUSD`, stablecoin pairs) | `GET /api/v3/account` → `permissions` |
| Any zero-fee Binance pair (FDUSD, USDC, U promotions) | `GET /api/v3/account/commission?symbol=…` or `GET /sapi/v1/asset/tradeFee` |
| Simple Earn for idle USDT/USDC: eligible from the UK? at what rate? | `GET /sapi/v1/simple-earn/flexible/list?asset=USDT` |
| Withdrawal fees and networks for a Revolut X ↔ Binance stablecoin transfer | `GET /sapi/v1/capital/config/getall` (Binance); Revolut X has no public withdrawal API |
