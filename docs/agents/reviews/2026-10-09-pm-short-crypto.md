# PMSC: Polymarket's 5- and 15-minute "Bitcoin Up or Down" markets against the BTC venues (2026-10-09)

Davies, 2026-10-09, asked first: "polymarket的5分钟比特币涨跌等短市场和我们的的数据源和可以下单对冲的券商之间有套利空间吗".
Later the same evening he added "这里加上Binance和Hyperliquid". The question is whether these markets leave an arbitrage
or a statistical edge. The edge could sit between the markets themselves, the price feeds we can read, and the venues
where a hedge could be placed.

## 0. Verdict

**There is no edge we can take.** These markets do have a real information edge: the book trails Binance and Coinbase.
But that edge lasts only about a quarter of a second after BTC moves, and fast traders already take it. Our fastest
lawful path cannot get there in time:

- a Supabase loop in `eu-west-1` reacts in 0.7–1.0 s (reference §3.39);
- an always-on Worker holding a socket might react in about 0.25 s;
- either way, Polymarket then delays every taker order on a crypto market by another 150 ms (fp4).

- **Taking cheap asks.** This works only in the first 0.1–0.25 s. Take the live episodes where the ask sat at least 5 ¢
  under fair after the fee, and say the order arrives L seconds after the episode opened. The fill's 5-second markout
  (the mid 5 s later, less the price and the fee) is:
  - with L = 0: +2.4 ¢ a share (Coinbase as the fast feed) or +3.9 ¢ (Binance's perp);
  - with L = 0.1 s: +1.3 ¢ or +2.2 ¢;
  - with L = 0.25 s: −0.2 ¢ or +1.0 ¢;
  - with L = 0.5 s: −0.7 ¢ or −0.1 ¢;
  - with L = 1 s: −1.6 ¢ or −1.6 ¢;
  - with L = 2 s: −1.7 ¢ or −1.6 ¢.

  Two days of history agree. On the prints the model calls at least 10 ¢ cheap, the taker made:
  - +14.9 ¢ a share with the model read at the print's stamp;
  - +8.7 ¢ with it read 3 s earlier;
  - +1.2 ¢ at 10 s;
  - −0.2 ¢ at 30 s.
- **Making.** A maker who posts both sides around fair and re-quotes each second gets picked off. Every one of the 32
  arms has a negative 5-second markout, −1.5 to −9.3 ¢ a dollar filled. They lose to the outcome too, −1 to −33 ¢ a
  dollar. The only subsidy is the maker rebate: 20 % of the fee-equivalent, which is 0.35 ¢ a share at 50 ¢ (about
  0.7 % of what is filled). These markets carry no liquidity-reward pool. None of the 61 BTC up/down windows checked is
  among the 18,530 markets that have one.
- **Hedging is arithmetic, and the arithmetic fails.** Say we hold $1,000 of an at-the-money Up or Down position in
  the middle of its window. Offsetting its sensitivity to BTC would take about $1.4 M of BTC for a 5-minute market, or
  $0.6 M for a 15-minute one. Each rebalance of a hedge that size costs:
  - $1,256 at Revolut X's 0.09 %;
  - $698 at Binance's perp taker 0.05 %;
  - $628 at Hyperliquid's 0.045 %.

  The binary cannot be hedged on any of the five venues. It is a bet, never a hedged trade.
- **Slow statistical rules lose.** Two such rules were tried on 1.07 M in-window taker prints over two days: buying in
  a fixed price band at a fixed time left, and buying when the model says cheap against a 30-second-old price. Both are
  flat to negative after the fee.
- **On average the takers lose.** On those two days they paid $15.0 M and lost 1.9 % of it after fees ($280k). The fees
  alone were $309k, so before fees the takers were up $29k.

**Expected money at $100–$1,000 a trade: negative.** The best row we could plausibly reach is the 5 ¢ threshold with
the order landing 0.5 s late. Its markout is −0.7 ¢ (Coinbase as the fast feed) or −0.1 ¢ (Binance's perp) a share.
To the outcome it is −2.1 ¢ or +2.2 ¢, and the window bootstrap of each spans zero. Every slower row is negative, and
so is every maker arm.

**Confidence.**
- **High** that nothing positive is left from 0.5 s on. Three independent measures agree:
  - 1.07 M historical prints over 768 windows;
  - book-level markouts over 49 live windows;
  - the time the competition takes to hit a cheap price (p50 0.14–0.18 s).
- **Moderate** on the size of the loss. Outcome P&L over 49 windows is noisy, and every timing is measured from this
  container, not from `eu-west-1`.

**No paper test is proposed.** §9 says what would reopen the question.

**What this is.** Research only, on keyless public data:
- Polymarket's Gamma API, its CLOB's public WebSockets and `/v2/trades`, and its RTDS price feed;
- the public market data of Coinbase, Kraken, Binance (spot and USDⓈ-M perp) and Hyperliquid.

Nothing was traded or placed. No key was used or printed, and no production table was read. Every figure comes from
`docs/agents/backtests/pm_short_crypto/`, which holds the scripts, the inputs they read and the results. Every file and
its sha256 is listed in `MANIFEST.json`.

`scripts/run_all.sh` re-runs every analysis from the committed inputs and gave byte-identical results, except H4 and
the pulls, which read the network. H4's wallets are hashed before they are written.

**What fp4 already covered, and what is new here.** fp4 (`reviews/2026-09-24-polymarket-fp4-study.md`) measured the
HOURLY up/down markets, which settle on Binance's 1 h candle. There M3b found −2.8 ¢ a share at the real prints. fp4
dismissed the 5- and 15-minute markets by arithmetic alone (its B7: "a quote is ten ticks stale after a minute").

This study measures the 5- and 15-minute BTC markets themselves:
- at the print, over two days;
- at the book, live, at 100 ms;
- against every feed we can read.

## 1. How the markets settle and trade

All of this is from Gamma and from `results/h0_resolution.json`, `series.json`, `rewards_current.json` and
`l4_response.json`.

**Settlement.** The rule text says: Up if "the time-weighted average price (TWAP) of Bitcoin, generated by Chainlink"
for the window is ≥ "the price at the beginning". The source is Chainlink's `btc-usd-twap-60s` Data Stream, and Gamma's
config is `btc-5m-twap-60` with `twapLookbackSeconds: 60`.

What that means in practice was measured over seven days of windows, 2,016 of 5 minutes and 672 of 15 minutes:
- **Every window's start price (`priceToBeat`) IS the previous window's `finalPrice`.** This held on all 2,008 5-minute
  and 668 15-minute adjacent pairs with both prices. Each 15-minute start price also equals the 5-minute start price at
  the same instant (671 of 671).
- So the outcome is Up iff TWAP60(end) ≥ TWAP60(start), where TWAP60(t) is the stream's 60-second average at t. The
  recorded outcome matched `finalPrice ≥ priceToBeat` on 2,010 of 2,010 and 670 of 670.
- Computing the same comparison from Binance's 1 s closes agrees with the outcome 97.7 % of the time (1,964 of 2,010)
  for 5-minute windows and 98.8 % (662 of 670) for 15-minute ones. Comparing Binance's spot price at the two endpoints
  instead agrees only 86.2 % and 93.7 % of the time.
- One live check: the 19:25–19:30 UTC window's `finalPrice` was $82,388.41. The 60-second mean of Chainlink's
  per-second values recorded here was $82,387.70; the spot value at 19:30:00 was $82,377.71.
- So the final minute is an average. A last-second print can move the result only a sixtieth as much as a spot settle
  would.

**Resolution timing.** Windows resolve automatically, a median 54 s after the end (p90 87 s, max 162 s).

**Fees.** `crypto_fees_v2`: a taker pays 0.07 × p(1 − p) a share, which is 1.75 ¢ at 50 ¢ and 0.63 ¢ at 90 ¢. Makers
pay nothing and earn back 20 % of the fee-equivalent of their fills (`pm_fees.ts`). There are no holding rewards.

**Tick and size.** The tick is 0.01, and 0.001 near the extremes. The minimum order is 5 shares.

**Book shape.** These figures are medians over the live book records with the Up mid between 0.10 and 0.90:
- The spread is one tick 60 % of the time on 5-minute books and 57 % on 15-minute ones.
- The touch holds $37 of Up ask and $36 of Down ask on 5-minute books; 15-minute books hold $61 and $39.
- The best three levels hold $345 and $307 (5-minute), or $659 and $347 (15-minute).
- The touch price changes 73 times a minute on 5-minute books and 34 on 15-minute ones.

**Markets and volume.** Each day there are 288 BTC 5-minute windows and 96 15-minute ones. Over seven days:
- 5-minute: **$11.3 M a day**, median $37,175 a window;
- 15-minute: **$4.0 M a day**, median $27,474.

Gamma's 24 h figures for the other series: BTC hourly $0.65 M; ETH 5-minute $0.45 M and 15-minute $0.34 M; SOL
$0.14 M each; BTC 4-hour $0.11 M. XRP, DOGE, BNB, HYPE and ZEC are smaller still. BTC 5- and 15-minute markets carry
86 % of the 24 h volume of the 35 crypto up/down series.

**Liquidity rewards.** None. Each market carries `rewardsMinSize` 50 and `rewardsMaxSpread` 4.5. But no BTC up/down
condition id, current or one of the next 29 per series, is among the 18,530 markets in
`/rewards/markets/current`.

## 2. The model of fair value (H1)

This is in `scripts/model.py` and `results/h1_model_fit.json`. Up's fair price is Φ((E[F] − K)/sd), where:
- K is the start TWAP;
- F is the 60-second average at the end;
- with more than 60 s left, the variance is σ²·(τ − 40);
- inside the last minute, the part already averaged is known, and the variance is σ²·τ³/(3·60²).

σ² is k times Binance's 1 s realised variance over the last 30 minutes. k was fitted on five training days, the
windows from 2026-10-02 19:00 to 10-07 19:00 UTC: k = 1.75 for 5-minute markets and 2.5 for 15-minute ones.

On the two test days the model is calibrated. Log-loss is 0.391 (5-minute) and 0.430 (15-minute); its probability
deciles win within a few points of their mean. Brier with more than 120 s left is 0.179 (5-minute) and 0.163 (15-minute),
against 0.25 for a coin flip.

Against the prints (H7):
- The model is as good as the print price, or a little better, read at the print and also 3 s before it.
- In the last 20 s it is far worse: 0.218 against 0.090 (5-minute). There the outcome turns on Chainlink's own few
  dollars, which Binance's price does not see. That is why the live study reads Chainlink itself for the averaged part.

## 3. What history says: the edge decays in seconds (H2, H3, H5)

These figures cover every in-window taker print of the 768 windows from 2026-10-07 19:00 to 10-09 19:00 UTC (835,990
on 5-minute markets, 234,387 on 15-minute ones; `results/h2_prints.json`, `h3_edge_lag.json`).

Each print is scored as the taker's buy of one side. Its realised P&L is the payout, less the price, less the fee. The
table keeps the prints the model calls cheap by the threshold shown, with the model read LAG seconds before the
print's stamp. The data API stamps a print about 2 s after its match (§3.39), so lag 0 can see a little past the match.

| realised ¢ a share (shares) | lag 0 | lag 3 s | lag 10 s | lag 30 s |
|---|---:|---:|---:|---:|
| 5-minute, edge ≥ 10 ¢ | +14.9 (1.38 M) | +8.7 (1.15 M) | +1.2 (2.82 M) | −0.2 (5.27 M) |
| 5-minute, edge ≥ 5 ¢ | +8.3 (3.10 M) | +3.4 (2.79 M) | +0.5 (4.87 M) | −0.1 (6.95 M) |
| 15-minute, edge ≥ 10 ¢ | +7.1 (0.58 M) | +3.4 (0.56 M) | +1.2 (0.71 M) | −2.2 (1.14 M) |
| 15-minute, edge ≥ 5 ¢ | +6.5 (1.17 M) | +3.8 (1.10 M) | +1.9 (1.34 M) | −2.3 (1.84 M) |

So the takers who bought what the model called cheap did make money. On 5-minute markets they made about $100k over
the two days at lag 3. But the gain belongs to whoever was there within a second or two of the move; ten seconds late,
it is gone.

Two further readings:
- **Price band by time left** (H5, `h5_price_buckets.json`): no band is consistently positive after the fee, and the
  signs alternate.
- **Takers as a whole:** 5-minute takers paid $11.18 M and lost $210k (−1.88 %), of which $224k was fees. 15-minute
  takers paid $3.81 M and lost $70k (−1.83 %), of which $85k was fees.

## 4. What the live book says (L1–L4)

**The recording.** Polymarket's market WebSocket gave the Up book of the current and next 5- and 15-minute windows,
plus every trade. RTDS gave Chainlink BTC/USD and Binance BTCUSDT, a value a second. Coinbase, Kraken, Binance spot,
Binance's USDⓈ-M perp and Hyperliquid's perp came over their own public WebSockets.

Every record carries this container's receive time.

| segment (UTC) | books and RTDS, Coinbase, Kraken | Binance and Hyperliquid |
|---|---|---|
| A | 19:38:46–21:06:20 | 20:03:18–21:06:20 |
| B | 21:09:50–22:44:50 | 21:09:51–22:44:51 |

**The 3.5-minute gap between them is the container's restart at about 21:06 UTC.** The analyses skip any instant whose
newest book or price record is over 10 s or 5 s old, so no reading spans the gap.

The CLOB socket dropped and reconnected 44 times (27 in segment A, 17 in B). 25 of those were "slow consumer"
closes. Each loses a second or two of book, also skipped by the same rule.

Covered in all: 38 5-minute and 13 15-minute windows, of which 37 and 12 had resolved when read. Their volume was
$1.32 M and $0.78 M.

**Who leads.** From `l1_leadlag.json`: the correlation of 1 s changes, on a 100 ms grid, peaks at the lags below.

| feed | lag behind Binance's perp |
|---|---|
| Binance spot, Coinbase | 0 (at this resolution) |
| Kraken | +0.2 s |
| Binance via RTDS | +0.8 s (it relays one value a second) |
| Hyperliquid's best bid/offer | +0.8 s (Hyperliquid stamps it a median 300 ms before it arrives here) |
| Chainlink BTC/USD, the settlement feed, via RTDS | +2.4 s |
| Hyperliquid's mark and oracle prices | +4.4 s |
| **Polymarket's 5-minute Up mid** | **+0.4 s**, and 2.0 s AHEAD of Chainlink |

So the book is priced from the exchanges, not from the oracle feed. Anyone who waits for Chainlink, or for anything
RTDS or Hyperliquid relays, is 0.8–4 s behind the book. Only a direct Binance or Coinbase socket is as fast as the
traders setting the book.

**How fast the book answers** (`l4_response.json`). Take a Coinbase move of 2 bps or more within a second. The
5-minute book moves a tick its way after a median 0.30 s (p25 0.14 s, p90 1.98 s), in 40 of 45 cases within 10 s. The
15-minute book takes 0.34 s.

**Cheap asks** (`l2_opportunities_cb.json` and `_bf.json`). An episode is a run of 100 ms points where a side's best
ask sits at least the threshold below fair, after the fee. Fair is the model, with Coinbase (or Binance's perp)
standing in for Chainlink between Chainlink's own values.

- With a 5 ¢ threshold there are 260 episodes an hour (133 with Binance's perp). The median episode lasts 1.2 s and
  47 % last under a second.
- The median size at the touch is $20.
- **Someone else prints at that price a median 0.14 s after the episode opens, within 1 s in 77 % of episodes.**

The table covers all fills at the 5 ¢ threshold, with a $100 order arriving L seconds after the episode opened. It
fills against the book as it then stands, at or below the price first seen.

| L | filled | 5 s markout, ¢/share (Coinbase / Binance perp) | to the outcome, ¢/share | outcome bootstrap p5–p95, $ (Coinbase) |
|---|---:|---:|---:|---:|
| 0 | 798 / 350 | +2.4 / +3.9 | +0.3 / +3.8 | −7,385 to +9,329 |
| 0.1 s | 704 / 320 | +1.3 / +2.2 | −2.4 / +1.6 | −10,815 to +6,859 |
| 0.25 s | 622 / 282 | −0.2 / +1.0 | −2.3 / −0.5 | −13,513 to +9,870 |
| 0.5 s | 547 / 232 | −0.7 / −0.1 | −2.1 / +2.2 | −13,537 to +10,485 |
| 1 s | 484 / 185 | −1.6 / −1.6 | −4.6 / +0.4 | −18,126 to +8,066 |
| 2 s | 431 / 170 | −1.7 / −1.6 | −5.8 / −2.0 | −18,522 to +5,348 |

The outcome column has 47 and 40 windows behind it, and its bootstrap is clustered by window. That makes it too noisy
to read alone. The markout uses the book itself 5 s later and is the steadier measure.

At thresholds of 0 and 2 ¢ the picture is the same, and worse: markouts are negative from 0.25 s on.

**A one-second maker** (`l3_maker_*.json`). Each second it quotes Up's bid at fair − h and its ask at fair + h, post-only
and never crossing the touch, $100 a side. The quote goes live λ later: λ = 0.2 s for a Worker, 1.0 s for an Edge loop.
A taker print that trades through the quote, or (the optimistic bracket) at it, fills it.

All 32 arms (h 1–5 ¢, both λ, both fill rules, both fast feeds) lose:
- 5 s markout −1.5 to −9.3 ¢ a dollar;
- to the outcome −1 to −33 ¢ a dollar;
- rebate about 0.7 % of what was filled.

## 5. Hedging and the venues (H6)

This is in `results/h6_hedge_and_pool.json`, from Binance's 1 s variance over seven days (0.41 bps a second).

| position | BTC notional to hedge it | one rebalance at 0.09 % (Revolut X) | at 0.045 % (Hyperliquid) |
|---|---:|---:|---:|
| 5-minute, $1,000 at the money, 150 s left | $1.40 M | $1,256 | $628 |
| 5-minute, $1,000, 60 s left | $3.27 M | $2,946 | $1,473 |
| 15-minute, $1,000, 450 s left | $0.60 M | $544 | $272 |
| $100 positions | a tenth of the above | | |

A 1σ one-second BTC move shifts an at-the-money price by 1.4–8.9 ¢. So the hedge would need re-setting every second
or two, not once.

Hedging fails on every venue, for the same reason: the notional, not the fee. The venues as measured or recorded:

- **Revolut X:** spot only, 0.09 % taker. A Down hedge needs BTC already held.
- **Kraken:** spot, 0.40 % maker at this account's tier.
- **Binance spot:** 0.10 %, $5 minimum, 0.00001 BTC step (read from `data-api.binance.vision`).
- **Binance USDⓈ-M perp:** 0.05 % taker (fp6).
- **Hyperliquid perp:**
  - 0.045 % taker and 0.015 % maker at the base tier (its docs; not read from its API);
  - 5 size decimals; 40× maximum leverage;
  - funding was +0.00107 % an hour on average over the last 170 hours.

**The maker pool on the two test days.** Taker fees came to $112k a day on 5-minute markets and $42k a day on
15-minute ones. 20 % goes back to makers: $22.4k and $8.5k a day.

All makers together lost $7.0k and $7.5k a day to the takers before the rebate, and so netted +$15.4k and +$1.0k a day
after it. A slower maker than the ones already there would take the worst fills of that, which is what §4's maker
shows.

## 6. The competition (H4, L2, L4)

H4 read one 5-minute market in six over the two days, 96 markets, with wallets:
- 6,169 taker wallets traded;
- the prints the model called cheap (≥ 5 ¢ at a 3 s lag) were spread over 2,924 of them;
- the top 10 took 26 % and the largest 7.6 %.

So the takers are not one bot. But the cheap price is taken a median 0.14–0.18 s after it appears. The touch moves
73 times a minute. The book answers a 2 bps move in 0.30 s. The two days' takers who bought what was cheap 3 s earlier
made money; those who bought 30 s late did not.

**What is left for a participant reacting in 1 s from `eu-west-1`: nothing.** A participant reacting in 0.25 s would
be at break-even at best, before the 150 ms taker delay and before its own feed's distance from Binance.

## 7. Each venue, and what stands in the way for a UK or Ireland resident

None of this was assessed by counsel. It records what the repo already knows and what was seen here. Binance and
Hyperliquid are kept in the study as Davies asked; neither changes the verdict.

- **Polymarket.** Positions open only from `eu-west-1` under Davies' standing Ireland attestation
  (`docs/agents/CLAUDE.md`). The UK is close-only. The existing order path posts post-only maker quotes; there is no
  taker (FAK) path.
- **Binance.**
  - This container is refused with 451 by `api.binance.com` and `fapi.binance.com`. Its public data hosts
    (`data-api.binance.vision`, `data-stream.binance.vision`, `fstream.binance.com`) answer.
  - The repo's key reads and can trade spot; futures, margin and withdrawals are off (reference §6). Binance rows are
    paper-only by a database constraint.
  - The FCA has banned the sale of crypto derivatives to UK retail since January 2021, so a perp hedge is closed to a
    UK retail account.
  - Binance's onboarding terms for UK and Irish residents were not checked here.
- **Hyperliquid.** It is a non-custodial perp DEX: no account, no KYC, orders signed by a wallet. Its terms of service
  and any geo-block were not read here. A UK retail resident trading perps on it sits against the spirit of the FCA's
  derivatives ban; the legal position is not assessed. As a price feed it is the slowest measured:
  - its best bid/offer is 0.8 s behind Binance's perp;
  - its mark and oracle prices are 4.4 s behind.
- **Revolut X and Kraken.** These are the repo's own spot venues, open to this account. Neither can carry a hedge of
  this size (§5).

## 8. Expected money, put plainly

- **Taker at the reaction we can reach (0.5–1 s):** −0.7 to −1.6 ¢ a share by markout, and −2 to −5 ¢ to the outcome.
  At $100 a trade (about 200–250 shares) that is about −$1.5 to −$12 a trade. At $1,000, ten times that. The rows
  supporting this sit in the table in §4.
- **Maker re-quoting each second:** −1.5 to −9 ¢ a dollar filled. At $100 a side the fills came to $11k–$181k of
  notional across the arms, over 2.6–3.1 hours.
- **Hedged:** not possible (§5).
- **Unhedged, slow:** about −1.9 % of what is staked, the average taker's result (§3).

## 9. What would reopen it

The verdict would need re-reading in any of these cases:
- a path that acts within 0.1 s of Binance's perp. That means a socket to Binance and to Polymarket from the same
  region as Polymarket's matching engine. Signing orders outside `eu-west-1` conflicts with the repo's rule;
- a liquidity-reward pool appearing on these markets (`scripts/pull_rewards.py` checks);
- a change to the fee or to the 60-second settlement average.

The recorder (`scripts/recorder.py`, `recorder2.py`) and `l2`/`l3` re-run as they are on a fresh recording. **No
pre-registration was drafted:** the template is for a positive result, and this one is not.
