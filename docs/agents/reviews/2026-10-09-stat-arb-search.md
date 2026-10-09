# STATARB: other strategies with the structure of Stablecoin quotes and Reward quotes (2026-10-09)

Davies, 2026-10-09: "我觉得stablecoin quotes和Reward quotes这两个策略之所以work是因为都有statistical arbitrage，你再派个子代理研究一下还有没有其他有statistical
arbitrage的策略，其他平台也可以，并先不考虑合规问题". The same afternoon, on Kalshi: "我开不了Kalshi的账户，Kalshi平台可以rule out". So Kalshi is not a
venue here. Its prices are kept only as a reference, and nothing that needs a Kalshi position is ranked.

**What this is.** It is research only, on keyless public data. Nothing was traded, opened, funded or signed up for. No key
was made or read, and no production table was read. No pre-registration was frozen: the three in §5 are drafts. "Compliance aside" was
applied to the search only. Every candidate still lists what stands in Davies' way (§3, last column), so he can judge.
Nothing here recommends a VPN, a proxy or anyone else's account.

**Sources.** Every figure comes from `docs/agents/backtests/statarb_search/`: its scripts, the inputs they pulled (each
with its sha256 in `MANIFEST.json`) and its results. `s1_fiat_stable_sim.py` and `s1b_long_sim.py` re-run byte-identical
from the committed inputs. The snapshots (`pm_kalshi_match.py`, `smarkets_pm_match.py`, `smarkets_volumes.py`,
`pull_kalshi_lip.py`, `pull_limitless.py`, `pull_defi_yields.py`) read live books and commit what they read. A re-run
reads a later book.

## 1. Why the two work, and the rule this search drew from it

**Stablecoin quotes (PR5).** The price has an anchor known to the minute: interbank GBP/USD, which every coin book on the
venue implies to about a basis point (§3.26). The book deviates from that anchor because retail crosses it. The people
who could close the gap face a cost larger than the gap: a GBP↔USD conversion costs this account 36 bps across four
legs (§3.26, idea 12). Resting a quote costs nothing, at 0 % maker. The deviation then mean-reverts to the anchor, and
the exit at fair is filled by the next retail print. Nothing is forecast. The edge is the deviation's size times how
often retail prints through it, less adverse selection. That loss is small because the anchor does not move against the
quote, as a coin's price would.

**Reward quotes (RW).** A third party pays for resting liquidity. The pool and its scoring formula are public, and the
cost is adverse selection on fills, which the rules hold down: minimum size, pricing near the touch, re-selection of markets.

**The generator** asks five things of a candidate:

- an anchor the market must return to, or a public subsidy;
- someone who crosses the book without arbitraging it;
- a maker cost near zero;
- a barrier that stops faster or bigger players from taking the gap (a conversion cost, a regional book, a small size);
- an account Davies could hold.

The same rule explains the failures. Coin books have no anchor that does not move (fp2's h/σ₁ₘ). Kraken's
stablecoin books fail on cost: 0.20 % maker. Binance's zero-fee stablecoin books fail on the barrier: none, so ZF made
1.4–2.6 %/yr. On the Revolut X USD books at par (PR6), the deviation is under a tick.

## 2. Already tried, so skipped here

These were tested earlier, are not repeated, and had no new angle:

- cross-venue basis (§2c);
- funding carry, crowding and perpetual carry (§3.34, fp6 H1–H3);
- momentum, reversal and low volatility (§3.24–§3.25);
- liquidation bids (fp3 CB);
- Revolut X dislocation (§3.5);
- every Binance derivative (fp6);
- zero-fee Binance stablecoin books (PR2, ZF);
- Revolut X's own coin books and long tail (fp2 T1/T2, fp7);
- gold tokens and their weekend (fp1 #17, fp2 #7, fp3 R1);
- LST wicks on Binance (fp2 T3);
- tokenised stocks overnight (fp2 #9);
- UK crypto ETNs (fp2 #18; DAT);
- MSTR/BMNR against NAV (§3.45);
- US-equity calendar effects (EQ1, DFC);
- Polymarket favourites, weather, resolution, harvest, views and ladders (fp4, PMLATE, HARVEST, VIEWS);
- Polymarket's own maker rebates and holding rewards (fp4 P2, P4).

## 3. The ranked list

Ranking is expected edge × feasibility in this repo's setup: the Supabase minute loop, pg_cron to 1 s, a Worker below
that. "Screen" is §4's simplified PR5 round trip, $100 a rung, three rungs a side (10 / 20 / 30 bps), $600 a book. On the
same seven days the screen gives Revolut X's two UK books $0.63 a day on $1,200. PR5's realistic twin (`pr5`, £100 a
rung) realised £3.04 over 10-02 → 10-09 (the stablecoin quotes review, §1), about $0.58 a day. So the screen runs about
10 % above the twin on the books where both exist. Over a longer window it runs up to 2.2× above PR5's study (§4.2), so
it ranks books on one rule; it does not forecast what a book earns.

| # | candidate | mechanism (which of the two) | venue · cost | measured (screen, $600 a book unless said) | capacity at $100–$10k | speed | main risk | what stands in Davies' way | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **PR5-EUR**: PR5's rule on Revolut X's EEA USDC/EUR | anchor (EUR/USD) + retail crossing + 0 % maker, PR5's shape | Revolut X EEA · 0 % maker | S1 $1.20/day; S1b $0.80/day (from 08-24 $0.73), 500 trips, 44 of 45 days positive, best day 7.4 %; per dollar 1.6× (from 08-24) to 3.8× (S1) PR5's UK books | book $244k/day; $4.07/day at $1k a rung (S1b) | a minute, as PR5 | the gap tightening as the UK's did; a USDC de-peg; EUR/USD feed staleness | **an EEA Revolut X account.** Revolut ties one account to the country of residence, and a UK → Ireland move closes the UK account, which holds the live trend row and PR5's sub-account. Revolut Digital Assets (Europe) Ltd under MiCA (CySEC). Not confirmed with Revolut | **paper-test now** (public tape, PR5's engine with a EUR feed and a region filter); live only on an account decision |
| 2 | **CJ5**: PR5's rule on CoinJar UK's USDC/GBP and USDT/GBP | the same, on a second UK venue | CoinJar UK · 0.00 % maker, 0.001 % taker | S1 (eight days) $0.94 + $0.27 a day on $1,200; median 16.6 / 25.5 bps from fair; per dollar 1.9× the UK books in the same week | books $23k + $13k a day: a few dollars a day at most | a minute | the resident maker's 35 bps touch narrowing; only eight days of history | a CoinJar UK account and a trades-scope key (FCA-registered venue, no legal bar); a new venue client (JWT-signed); post-only support unverified | **record first** (28 days of keyless prints), then paper |
| 3 | **CBSWEEP**: deep 0 % bids on Coinbase's stable-pair books | anchor + sweeps by large sellers (fp3 CB's shape on an anchor that does not fall) | Coinbase Advanced · 0.00 % maker, 0.0045 % taker on `fx_stablecoin` pairs | S1 USDC-GBP $1.12/day (53 % one day); S1b USDC-GBP $0.24/day and USDC-EUR $0.16/day, almost all in September | books $2.8m (GBP) and $24.7m (EUR) a day; $2.19 + $1.56 a day at $1k a rung | a minute is enough to rest | sweeps being informed (a GBP or EUR shock the minute FX has not caught); months with none | a Coinbase Advanced account (the UK sign-up was unresolved in the venue survey); a new venue client | **history first** (years of keyless candles), then paper |
| 4 | Smarkets quotes around Polymarket's mid | anchor (Polymarket's 1¢ book) + a 4–8-point retail book | Smarkets · 2 % of net winnings | no fill model: the 28 NFL winner markets matched £14,312 in total (median £132 a game) | pennies before game day; in-play unmeasured | seconds near kickoff (team news) | adverse selection on news | a Smarkets account (UK-legal; winnings untaxed for a UK resident); Betfair, where the volume is, needs a key | **dead on capacity** at this horizon |
| 5 | Matched betting (bookmaker offers hedged on an exchange) | an explicit subsidy, RW's shape | UK bookmakers + Betfair/Smarkets | not measured (no keyless source) | one-off offers, hundreds of pounds in all | manual | account restrictions | legal for a UK resident; bookmakers' terms forbid automation | **not for this repo** |
| — | Polymarket ↔ Kalshi cross | the same event on two venues | — | taker cross $1.0069–$1.08 (one $0.9999 on a $5 book); mids agree to 0.5–1¢ | — | — | — | **Kalshi ruled out** (Davies) | dropped; Kalshi kept as a price reference only |
| — | Kalshi Liquidity Incentive Program | subsidy, RW's shape | Kalshi | about $384,968 a day over 6,455 markets | — | — | — | US members only; **Kalshi ruled out** | dropped |
| — | Limitless rewards | subsidy | Limitless (Base) | 343 rewardable markets, every pool $0 | — | — | — | — | dead now |
| — | DeFi stable-stable LPs, HLP vault | subsidy / fees | DefiLlama pools, Hyperliquid | LP median 0.58 %/yr; HLP 4.06 % APR | — | — | de-peg; perps | perps: FCA retail ban | dead (below or at cash) |
| — | stETH against Lido's queue | redemption anchor | DEX + Lido | 2.3 bps discount, 1.8-day queue, ~1 bp net | — | — | stress only | — | dead in calm |
| — | Kraken stable/FX books; Bitstamp; Coinbase USDT, EURC, TGBP, AUD, SGD; CoinJar AUD | anchor | — | Kraken 0.20 % maker (40 bps a trip); the rest ≤ 6 %/yr or negative on the screen | — | — | — | — | dead |

## 4. The measurements

### 4.1 S1: every stablecoin-against-currency book, seven days (2026-10-02 → 10-09 UTC)

**The books.** The census covered five venues:

- Kraken has 70 stablecoin, FX and pegged books (`AssetPairs`). Since 2026 it charges 0.20 % maker / 0.20 % taker
  at the entry tier on every stablecoin, pegged and FX pair (its fee schedule, read 2026-10-09). The exceptions are
  USDe books (a 0 % campaign "until the 30th June, 2026") and USDG books (0 % maker, 0.01 % taker). A 40 bps round trip
  against the 3–17 bps deviations measured below kills Kraken by arithmetic, so it was not simulated.
- Coinbase flags 12 books `fx_stablecoin`. Its stable pairs charge the maker 0.00 % and the taker 0.0045 %, per
  Coinbase's exchange-fees page as quoted by search. The fee page itself refused this machine (403), so the rate is
  unverified at source. USDT-USDC and USDT-USD are not stable pairs any more.
- Bitstamp has USDC/EUR, USDT/EUR and EURC books. Its stable-pair fee was not found, so it was scored at 0 % and still
  fails.
- CoinJar UK charges 0.00 % maker and 0.001 % taker on stablecoin↔fiat (coinjar.com/uk/fees, read 2026-10-09). It has
  FCA registration and a trading API with "trades"-scope keys (docs.exchange.coinjar.com).
- Revolut X's public tape carries each print's region. Its EEA side trades USDC/EUR, while the UK account can trade
  only UK books (§3.26, idea 20).

**The anchor.** Yahoo's 1-minute FX (`GBPUSD=X`, `EURUSD=X`, `AUDUSD=X`, `CAD=X`, `SGD=X`). USDT's dollar value is
Coinbase's USDT-USD minute close. USDC = $1, EURC = €1, TGBP = £1.

**The rule** (`s1_fiat_stable_sim.py`, one rule for every book):

- Fair comes from the previous minute's FX. There are no entries when FX is over 10 minutes old (PR5's
  `QUOTE_FX_LOOKBACK_MS`), so weekends make none.
- A bid rests at fair(1 − q) and an ask at fair(1 + q). A fill needs a print strictly through: Revolut X's and CoinJar's
  prints, or the trade-built 1-minute low or high on Coinbase and Bitstamp.
- Size is $100, or the print's own size, or 10 % of the minute's volume for candles.
- The exit rests at the current fair and needs the whole position through. A 24-hour stop closes at the minute's close.
- The venue's maker fee applies on both legs.

**Results.**

| book | trips | stops | $ / 7 d | $ / day | %/yr on $600 | best day | at $1k a rung, $/day | median \|dev\| bps | p90 | $ vol / day | volume ≥ 10 / 20 / 30 bps from fair |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Revolut X UK USDC-GBP (PR5) | 16 | 0 | 1.58 | 0.226 | 13.7 | 53 % | 1.40 | 3.2 | 10.4 | 62,983 | 40 / 0.7 / 0.4 % |
| Revolut X UK USDT-GBP (PR5) | 34 | 1 | 2.81 | 0.401 | 24.4 | 39 % | 2.15 | 3.8 | 18.9 | 138,327 | 52 / 41 / 6.6 % |
| **Revolut X EEA USDC-EUR** | **120** | 0 | **8.41** | **1.201** | **73.1** | 47 % | **4.29** | **9.0** | 16.8 | 186,796 | 61 / 3.3 / 0 % |
| **Coinbase USDC-GBP** | 53 | 0 | 7.86 | 1.123 | 68.3 | 53 % | 11.12 | 1.5 | 3.2 | 3,140,078 | 0.8 / 0 / 0 % |
| Coinbase USDT-GBP | 10 | 0 | 0.32 | 0.046 | 2.8 | — | 0.58 | 2.2 | 4.0 | 3,742,096 | 1.0 / 0.5 / 0 % |
| Coinbase USDC-EUR | 30 | 1 | 1.33 | 0.190 | 11.6 | 66 % | 1.90 | 3.4 | 5.6 | 31,547,563 | 1.1 / 0.4 / 0 % |
| Coinbase USDT-EUR | 13 | 1 | −0.33 | −0.047 | −2.9 | — | −0.48 | 4.6 | 6.3 | 23,399,887 | 0.5 / 0 / 0 % |
| Coinbase EURC-USDC | 18 | 1 | 0.69 | 0.099 | 6.0 | 85 % | 0.87 | 3.1 | 5.3 | 5,754,969 | 1.9 / 0 / 0 % |
| Coinbase TGBP-USDC | 11 | 0 | −0.29 | −0.041 | −2.5 | — | −0.45 | 2.6 | 9.1 | 59,865 | 11 / 0 / 0 % |
| Coinbase USDC-AUD | 17 | 2 | 0.60 | 0.086 | 5.2 | 67 % | 0.12 | 8.4 | 13.2 | 211,663 | 19 / 0.6 / 0.2 % |
| Coinbase USDC-CAD | 32 | 0 | 3.61 | 0.516 | 31.4 | 36 % | 1.05 | 1.5 | 5.7 | 74,466 | 8.2 / 5.8 / 4.9 % |
| Coinbase USDC-SGD | 1 | 0 | 0.07 | 0.010 | 0.6 | — | 0.01 | 2.4 | 4.6 | 522,418 | 0 / 0 / 0 % |
| Bitstamp USDC-EUR (fee 0 assumed) | 18 | 1 | 0.63 | 0.090 | 5.5 | 44 % | 0.93 | 3.4 | 5.3 | 10,318,506 | 0.3 / 0 / 0 % |
| Bitstamp USDT-EUR (fee 0 assumed) | 9 | 1 | −0.26 | −0.037 | −2.3 | — | −0.37 | 4.7 | 6.3 | 23,524,573 | 0.2 / 0 / 0 % |
| **CoinJar UK USDC-GBP** | 63 | 0 | 6.61 | 0.944 | 57.4 | 30 % | — | **16.6** | 28.7 | 23,158 | 85 / 23 / 6.3 % |
| CoinJar UK USDT-GBP | 24 | 3 | 1.86 | 0.266 | 16.2 | 54 % | — | 25.5 | 33.3 | 13,245 | 83 / 70 / 29 % |
| CoinJar USDC-AUD | 0 | 0 | 0 | 0 | 0 | — | — | 14.6 | 19.5 | 265,227 | 37 / 2 / 0 % |

The "best day" column is the largest day's share of the total. CoinJar's 500 public prints are its whole keyless history
(the trades endpoint does not page back), about eight days.

**What the table says.**

- **Revolut X's EEA USDC/EUR book is the PR5 market before 2026-08-24.** Its median distance from fair is 9.0 bps,
  against 3.2–3.8 on the UK books. It swings both ways: 55 bid and 56 ask trips at the 10 bps rung, at every hour,
  0–61 a day, five weekdays of five positive. On the same rule it makes 3.8× the UK books' combined screen per dollar
  of capital ($1.201 a day on $600 against $0.627 on $1,200). Its tape (€1.59 m in seven days) is larger than both UK books' together (£1.22 m).
- **Coinbase's deep fx-stablecoin books sit within 1.5–4.6 bps of fair**, a tick or two. They pay only when a large seller
  sweeps the book. On USDC-GBP, 14 of the 33 minutes beyond 10 bps fell on 10-02 09:13–09:50 UTC, when 1-minute lows reached
  −94 bps on $100k–$450k minutes. The money is episodic: 53 % on one day. It is a sweep-bid on an anchored book (fp3
  CB's shape, but the anchor does not fall). USDC-CAD's figures are similar, on a book of $74k a day.
- **CoinJar's UK GBP books are the widest anchored books measured**: a 35 bps touch, median 16.6–25.5 bps from fair.
  At 0 % maker they screen like PR5's UK books, $0.94 + $0.27 a day on $1,200. They are a fifth of PR5's books' size
  ($23k and $13k a day), and the venue is UK-registered.
- **Dead on this screen**: Bitstamp (even at 0 % fee), Coinbase USDT-GBP, USDT-EUR, EURC, TGBP, AUD and SGD, and
  CoinJar USDC-AUD.

### 4.2 S1b: the 13 weeks before (2026-07-06 → 10-02 UTC)

**Window.** The same simulator (`s1b_long_sim.py`) ran on the weeks before S1, with FXCM's 1-minute bid/ask mid as the
anchor, which is the PR5 study's anchor. `pull_long.py` pulled from 2026-07-06, but FXCM's archive answers 404 for 2026
weeks 26–31 (its log, re-checked by hand). The scored window is therefore **2026-08-10 00:00 → 10-02 00:00 UTC, 53
days**, two weeks of them before the week of 2026-08-24, when PR5's UK books tightened (§3.27). July's prints are
pulled and committed, not scored.

| book | trips | stops | $ (53 d) | $/day | %/yr on $600 | before 08-24, $/day | from 08-24, $/day | best day | days + / − | at $1k a rung, $/day | median \|dev\| bps | $ vol / day |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| Revolut X UK USDC-GBP | 169 | 4 | 15.30 | 0.289 | 17.6 | 0.345 | 0.269 | 8.7 % | 38 / 2 | 1.83 | 4.7 | 71,239 |
| Revolut X UK USDT-GBP | 508 | 3 | 69.26 | 1.307 | 79.5 | 3.151 | 0.645 | 13.7 % | 41 / 0 | 7.54 | 4.1 | 102,393 |
| **Revolut X EEA USDC-EUR** | **500** | 2 | **42.58** | **0.803** | **48.8** | 1.002 | **0.732** | 7.4 % | **44 / 1** | **4.07** | **8.9** | **243,629** |
| Coinbase USDC-GBP | 100 | 0 | 12.64 | 0.238 | 14.5 | 0.010 | 0.321 | 15.0 % | 22 / 1 | 2.19 | 1.2 | 2,822,277 |
| Coinbase USDT-GBP | 48 | 0 | 2.14 | 0.040 | 2.4 | 0.167 | −0.005 | 33.4 % | 14 / 7 | 0.45 | 1.8 | 2,064,660 |
| Coinbase USDC-EUR | 66 | 0 | 8.44 | 0.159 | 9.7 | 0.000 | 0.216 | 21.8 % | 15 / 3 | 1.56 | 1.2 | 24,717,194 |

By month (August from the 10th / September / October 1): EEA USDC-EUR $23.24 / $18.91 / $0.44; UK USDT-GBP $51.35 /
$16.48 / $1.44; UK USDC-GBP $7.49 / $7.32 / $0.49; Coinbase USDC-GBP $0.32 / $12.33; Coinbase USDC-EUR $0.39 / $8.07 /
−$0.02. By ISO week, EEA: $8.58, 5.44, 7.80, 5.17, 3.73, 3.81, 4.47, 3.58 (weeks 33–40), then S1's week $8.41.

**What the table says.**

- **The screen sees the tightening PR5's study found.** UK USDT-GBP fell from $3.15 a day to $0.65 at 08-24, and the UK
  pair together from $3.50 to $0.91 a day on $1,200.
- **EEA USDC/EUR tightened far less**: $1.00 to $0.73 on $600. From 08-24 it makes **1.6× the UK books per dollar**
  ($0.732 / $600 against $0.914 / $1,200), and 3.8× in S1's week. It was positive on 44 of the 45 days with a closed trip, its best
  day 7.4 % of the total. It rests on the 10 bps rungs (446 of 500 trips) and has the deepest tape of the anchored books
  outside Coinbase, $244k a day.
- **Coinbase made almost nothing in August and all of it in September.** Over the 53 days it earns about half the UK
  books' rate per dollar. Its advantage is capacity: $2.19 a day at $1k a rung on USDC-GBP, where the UK book makes
  $1.83.

**Calibration.** The screen runs above PR5's own simulator by a factor that varies. Over the same seven days of S1 it
was about 1.1× the `pr5` twin. From 08-24 here it makes $0.91 a day on the UK books, against the $0.42 a day PR5's
study measured over the 28 days to about 09-23 (2.2×; the windows overlap but are not equal). Read the screen as a
ranking of books on one rule, not as a forecast. Every comparison above is book against book on the same days.

### 4.3 S2: the same game on two prediction venues

**Kalshi, kept as a reference only.** Two keyless snapshots on 2026-10-09 (16:49 and 16:57 UTC) read 303 two-sided
Kalshi game events (NFL, NHL, college football, MLB, EPL). The first matched only 21 college games: Kalshi names cities and Polymarket names
nicknames, fixed for the second by the slug's away-home order. The second matched 96 to Polymarket's game markets by slug and
team: NHL 40, NFL 28, college 28. The two venues' mids differ by a median 1.0¢ (p90 3.5¢). Where both books are deep
($1,000+ at the touch, 36 games) they differ by a median 0.5¢. Buying team A at one venue's ask and team B at the other's,
with both taker fees, cost $1.0069–$1.08 everywhere but one game ($0.9999, on a $5 book). So there is no taker
arbitrage. The comparison stays as evidence that Kalshi's and Polymarket's prices agree to about half a cent on deep
games. Kalshi could serve as a second fair-value source for Polymarket quoting, nothing more.

**Smarkets (UK-regulated betting exchange) against Polymarket, 28 NFL games in the next 14 days** (17:09 UTC):

- Every Smarkets game matched.
- The taker-taker cross (Smarkets' 2 % commission on net winnings, Polymarket's 0.05 sports fee) cost $1.0117–$1.0798:
  no arbitrage.
- Resting a Polymarket bid at its best bid (maker 0 %) and hedging at Smarkets' offer locked in a profit on 3 of 28
  games: 0.9867, 0.9959 and 0.9963 per $1, with £14–£26 of payout at the hedging price.
- Smarkets' books are 0.5–8.7 points wide (median about 8) where Polymarket's are 1¢.
- That points to the PR5 shape: quote on Smarkets around Polymarket's mid. But Smarkets has matched £14,312 on the
  28 NFL winner markets so far (median £132 a game, `smarkets_nfl_volumes_2026-10-09.json`).
- **Dead on capacity** at this horizon. In-play and on the day are unmeasured. Betfair is where UK exchange volume is,
  and its API needs a key.

### 4.4 S3: who else pays for resting liquidity

| program | size, read 2026-10-09 | who may take it | verdict |
|---|---|---|---|
| Kalshi Liquidity Incentive Program | 6,455 active market programs at 17:53 UTC, about **$384,968 a day** (`period_reward` read as centi-cents; read as cents it would be $38.5 m, against Kalshi's stated $1–$1,000 per market per day); per-second snapshots, two-sided target size (median 1,000 contracts), a distance discount | "Most regular U.S. Kalshi members"; non-U.S. users ineligible (help.kalshi.com) | **ruled out** (Davies; and US-only) |
| Limitless (Base-chain CLOB) | 598 active markets, 343 `isRewardable` with Polymarket's formula shape (`minSize`, `maxSpread`, `c` = 3), **every `dailyReward` $0**; $559,815 of volume on the active markets; maker rebates on 32 | crypto wallet; terms not read | **dead now** (no pool); re-read with `pull_limitless.py` |
| DeFi stable-against-stable LPs (DefiLlama, 2,970 stable no-IL pools) | the 76 two-sided pools over $5 m: median fee yield **0.58 %/yr** (TVL-weighted 0.81 %), median 30-day total 0.65 %; 9.2 % beat cash + 4 points, all on exotic stables (reUSD, apxUSD, sDOLA) whose reward is the de-peg premium | anyone with a wallet | **dead** (below cash; the subsidy prices a risk) |
| Hyperliquid's HLP vault | APR 4.06 % (`vaultDetails`), $649k on $180 m over 30 days | a wallet; perpetuals (FCA retail ban, PS20/10) | **dead** (cash with tail risk, and not a strategy) |
| UK bookmaker sign-up and reload offers hedged on an exchange ("matched betting") | not measured: no keyless source | UK residents; bookmakers' terms forbid automation and restrict accounts that only take offers | an explicit subsidy, legal and tax-free for a UK resident, but **not for this repo** (manual, one-off, against the payer's terms) |

### 4.5 S4: a redemption anchor (stETH against ETH through Lido's queue)

- Lido's withdrawal queue makes stETH redeemable 1:1 by anyone.
- Selling 10 or 100 stETH on aggregators (ParaSwap, 2026-10-09 ~16:50 UTC) gave 0.99977 ETH: a 2.3 bps discount, with
  $0.64 of gas for the swap.
- The queue's estimate was 1.8 days (`wq-api.lido.fi`). Staking yields 2.25 % (Lido's 7-day SMA), so a request forgoes
  about 1.1 bps.
- Net is about 1 bp before the request and claim gas: **dead** in calm markets.
- It pays only in a stress episode, when queue and discount widen together. That is fp1's untestable de-peg lottery.
- CoinGecko's stETH-in-ETH hourly series is noisier than the edge (it read 1.0017–1.0023), so no history is claimed.

### 4.6 Not measured, with the reason

| idea | why not |
|---|---|
| tokenised T-bills (BUIDL, USYC, OUSG, USDY) against NAV | primary redemption needs KYC that is (mostly) institutional or non-retail; the secondary DEX books are small. The anchor arbitrage belongs to whoever has primary access |
| London ETNs or UCITS ETFs against iNAV at Trading 212 | the repo's T212 key is read-only. Whether a T212 limit order rests on the LSE book or fills against T212's quote is unverified. LSE market makers keep ETNs a few bps from iNAV |
| UK investment-trust discounts, ADRs and dual lines | 0.5 % stamp duty on UK buys (current status for trusts unverified) and 0.15 % FX at T212; slow value, not stat arb (DAT's power argument applies) |
| index rebalancing, option-expiry pinning | each needs a short or an option: closed to UK retail (fp6), Deribit unfunded |
| cross-venue funding (Hyperliquid against Binance) | perpetuals on both legs: the FCA retail ban, and fp6's carry family failed |
| Binance USDT/TRY, BRL and other fiat books | 10 bps maker (no zero-fee promotion on them found), so a PR5 rung needs ≥ 25 bps deviations; same-venue coin crosses imply the rate; access to TRY/BRL books from a UK account unverified |
| PR5's inventory through Coinbase (buy USDC near interbank at 0.45 bps, withdraw to Revolut X) | an operational cost cut for PR5's top-ups, not a new edge; noted for PR5's maintainers |

## 5. The top three, as draft paper tests

Each draft follows `TEMPLATE-variant-prereg.md`'s sections. **None is frozen.** Each needs its own design pass and
Davies' word before a migration. Nothing in them changes PR5, its twins or RW.

### 5.1 Draft: PR5-EUR, PR5's rule on Revolut X's EEA USDC/EUR book (paper, from the public tape)

**0. On whose word.** Davies' request of 2026-10-09 (quoted at the top). Nothing runs until he says so. A live version
needs an EEA Revolut X account, which this account is not (§6).

**1. What differs from its base.** The base is PR5 (`reviews/2026-09-23-pr5-paper-test-spec.md`, `quotes.ts`'s
`stepMinute`):

| | PR5 | PR5-EUR |
|---|---|---|
| book | UK USDC-GBP, USDT-GBP | EEA USDC/EUR: the public prints with `region = "EEA"` (USDT/EUR printed nothing in S1's week; its longer tape was not pulled) |
| fair | the USD book's 24-hour median ÷ interbank GBP/USD | the same USD book's median ÷ interbank EUR/USD from PR5's FX source, or FXCM's archive for a backfill |
| rungs, size, exits, stop | 0.1 / 0.2 / 0.3 % a side, £100 a rung, exit at fair, 24-hour stop | unchanged, €100 a rung, six rungs, €600 |
| fills | prints strictly through, size-capped | the same, on EEA prints only |
| tick | 0.0001 GBP | 0.0001 EUR (the tape's grid; to be read from the EEA pair config) |

This is not a twin row. `revx_sim.ts` and the twins read the UK books, and the engine takes GBP/USD. It needs a design: a
region filter on prints, a EUR/USD feed, and a currency label on the page. The data path is the one PR5 already uses
(`/api/1.0/public/trades/all`, which serves both regions).

**2. Why.** The screen made $1.201 a day on $600 over S1's week and $0.803 a day over the 53 days before ($0.732 from
08-24, 1.6× the UK books per dollar on the same days). Every ISO week was positive, $3.58–$8.58. The book's median distance from fair is 8.9–9.0 bps, the UK books' 3.2–3.8. It is the market
PR5 passed in before the UK books tightened in the week of 2026-08-24.

**3. Window, reading and bar.**

- **Window:** 28 days forward from the first minute after the freeze. A backfill over 2026-08-10 → the freeze is the
  in-sample expectation.
- **Bar:** PR5's spec's six conditions, read the same way: positive, the random-time null's p95, the stress run, the
  months, the share of the best day, and %/yr on the quotes' capital. Plus one more: its per-dollar result ≥ 2× PR5's
  UK books on the same days, since 2× is what would make an account change worth discussing.
- **Health until then:** each minute's prints read, FX age, no errors.

**4. Its record before now.** S1/S1b's screen, in sample; PR5's simulator re-run on the same inputs is the backfill to
build.

**5. Frozen files.** The design's engine change, its migration, and the backfill with its inputs (none written yet).

**6. Disclosures.** Every figure in §4.1–§4.2 was seen before any freeze.

### 5.2 Draft: CJ5, PR5's rule on CoinJar UK's USDC/GBP and USDT/GBP (recorder first, then paper)

**0. On whose word.** As 5.1. A live version would need a CoinJar UK account and a trades-scope key: Davies'
sign-up, and his word.

**1. What differs from its base.**

| | PR5 | CJ5 |
|---|---|---|
| venue | Revolut X UK | CoinJar Exchange UK (CoinJar UK Ltd, FCA-registered cryptoasset exchange) |
| books | USDC-GBP, USDT-GBP | USDCGBP, USDTGBP (`data.exchange.coinjar.com`), touch about 35 bps wide |
| fee | 0 % maker | 0.00 % maker / 0.001 % taker on stablecoin↔fiat (coinjar.com/uk/fees) |
| fair, rungs, size, exits, stop | as PR5 | unchanged |
| prints | the venue's whole history, keyless | only the last ~500 per book (about eight days): a recorder must keep them |

Step 1 is a keyless recorder: one Edge call a minute appends new CoinJar prints and the top of book. It joins
`edge_calls` and the watchdog, as every recurring call must. Step 2 runs PR5's simulator on the recorded prints. No
CoinJar order path is built before a pass.

**2. Why.** CoinJar's GBP books are the widest anchored books measured: median 16.6 and 25.5 bps from fair, 85 % and
83 % of volume ≥ 10 bps away. The screen made $0.94 + $0.27 a day on $1,200 over about eight days, the same order as
PR5's UK books ($0.63 on the same screen), on a UK-registered venue Davies may open. The books are small ($23k and $13k
a day), so the ceiling is a few dollars a day.

**3. Window, reading and bar.** Recording starts on Davies' word. The reading comes after 28 days of recorded prints,
by PR5's six conditions at £100 a rung, plus one more condition: post-only acceptance (does CoinJar offer post-only?) is
confirmed from its docs before any live design.

**4. Its record before now.** S1's eight days, in sample.

**5. Frozen files.** The recorder's function, its migration, and the simulator run (none written yet).

**6. Disclosures.** S1's CoinJar figures were seen.

### 5.3 Draft: CBSWEEP, deep bids on Coinbase's stable-pair books (history first, then paper)

**0. On whose word.** As 5.1. Live needs a Coinbase Advanced account; the venue survey records the UK sign-up as unresolved.

**1. What differs from PR5.** The rungs are deeper: 10 / 20 / 30 bps and also 50 bps. The books are the deep
`fx_stablecoin` books (USDC-GBP, USDC-EUR) at 0 % maker. Fills are read from Coinbase's trade-built 1-minute candles
historically, and from its public trade feed forward. Exit at fair, 24-hour stop. The expected shape differs from PR5:
nothing most days, then a sweep (10-02 09:13–09:50 reached −94 bps on USDC-GBP).

**2. Why.** S1: $1.12 a day on $600 on USDC-GBP, 53 % of it on one day. S1b: $0.24 a day on USDC-GBP and $0.16 on USDC-EUR over 53 days, $0.01 and $0.00 a day before 08-24, so it is lumpy by month as well as by day. These books trade $3–32 m a
day within 1.5–3.4 bps of fair, so a resting deep bid is free to hold until a sweep comes. Coinbase serves 1-minute
candles keylessly for years, so the test is historical first.

**3. Window, reading and bar.**

- A historical test on a window not yet read: 2025-10-01 → 2026-08-09, with FX from an archive that covers it (FXCM
  where it answers; Dukascopy or another minute source for its missing weeks, chosen before any P&L).
- PR5's six conditions, with the best-day share relaxed only if pre-registered.
- Then 28 days of paper from the public feed if it passes.

**4. Its record before now.** S1 and S1b, in sample.

**5. Frozen files.** The historical scorer and its FX inputs (none written yet).

**6. Disclosures.** S1 and S1b's Coinbase figures were seen.

## 6. What each would need from Davies

- **PR5-EUR.** Only Davies can decide whether an EEA Revolut X account is ever wanted. As read here, it means making
  Ireland his Revolut country of residence, which closes the UK account that runs the live trend row and PR5's
  sub-account; confirm with Revolut first. The paper test needs no account: one word to build it (a region filter, a
  EUR/USD feed, a page row), then its freeze.
- **CJ5.** His word to build a keyless recorder (one Edge call a minute, a watchdog row). For anything beyond paper, a
  CoinJar UK account, its verification, and a trades-scope API key he makes and stores himself.
- **CBSWEEP.** His word to run the historical test, which needs no account. For anything beyond paper, a working Coinbase
  Advanced account in the UK (the venue survey left its sign-up unresolved) and a trade-only key.
- **The rest:** nothing. Kalshi is out on his word; Smarkets, matched betting, Limitless, DeFi LPs, HLP and stETH are
  not worth a build now. `pull_limitless.py` and `smarkets_volumes.py` re-check two of them in seconds.
- **Standing rules kept:** never trade by hand in the loop's Revolut X account or PR5's sub-account (key `_2`).
  Polymarket opens a position only from Ireland under his attestation. Nothing here asks for a VPN, a proxy or anyone
  else's account.

## 7. What was not done or not checked

- Only one live snapshot each for the prediction-market and subsidy reads. No forward recorder was built.
- CoinJar's history is eight days; its post-only order type and API rate limits were not read.
- Coinbase's stable-pair fee is from Coinbase's own page as quoted by a search result: the page refused this machine.
  Coinbase UK's onboarding for Davies is unverified (the venue survey's "if signup works").
- Bitstamp's stable-pair fee was not found; it fails at 0 %.
- Revolut X EEA access for Davies was read from Revolut's help pages: one account per person, tied to the country of
  residence; a UK → Ireland move closes the UK account. The entity is Revolut Digital Assets (Europe) Ltd under
  CySEC/MiCA, per secondary sources. Not confirmed with Revolut.
- The screen is not PR5's simulator: no post-only refusal, no penny rounding, no order budget, and fills are capped at
  10 % of a candle minute. On the UK books it ran about 10 % above PR5's twin.
- Yahoo's minute FX is indicative, not a dealt rate (S1). FXCM's archive was used for S1b, as PR5's study did.
- No production table was read. Nothing was placed, cancelled, funded or signed up for.

## Files

- `docs/agents/backtests/statarb_search/`: scripts, inputs, results, and `MANIFEST.json` (sha256 of every file).
