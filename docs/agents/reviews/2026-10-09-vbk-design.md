# VB-K: value-bet slips for a human clicker, the strategy, its money and its design (2026-10-09)

Davies, 2026-10-09: "VB-K也可以自动化，只要策略制定好交给grokbot给我点就可以了，你仔细研究下具体策略和年化收益，并且和polymarket也可以结合".
VB-K is the top candidate of the second stat-arb search (`reviews/2026-10-09-stat-arb-search-2.md` §3.1, §4.1). The
plan he describes: this repository computes the strategy and writes a bet slip; grokbot, his own browser assistant,
places the bets by clicking in his bookmaker accounts. Nothing in this repository touches a bookmaker account.

**What this is.** Research and design only. Nothing was bet, traded, opened, funded or signed up for. No key was made
or read, and no production table was read. Every read was keyless and public: football-data.co.uk, Smarkets' public API,
and Polymarket's Gamma and CLOB. Nothing is frozen: §7 is a draft. Polymarket opens a position only from Ireland under
Davies' attestation. Never trade by hand in the loop's Revolut X account or in PR5's sub-account (key `_2`).

**Sources.** Every figure comes from `docs/agents/backtests/vbk/`, whose `MANIFEST.json` lists each file with its
sha256, including the 132 football-data files it reads from `statarb_search2/inputs/football/`. The scripts:
- `vbk_backtest.py`: the strategy, in sample and out of sample;
- `vbk_bankroll.py`: staking and pounds;
- `vbk_live_snapshot.py`: Polymarket against Smarkets, now;
- `vbk_pm_drift.py`: how far prices move in the minutes before kick-off;
- `vbk_matched.py`: free-bet arithmetic.

Re-running `vbk_backtest.py`, `vbk_bankroll.py` and `vbk_matched.py` gave the same bytes. The two live scripts read
books at 19:33 and 19:41 UTC and commit what they read.

## Plain summary

**The strategy.**
- Bet 1X2 (home / draw / away) at the best UK bookmaker price when that price beats the Betfair Exchange's fair price by
  at least 2 %, at odds under 5.
- The fair price is the exchange's prices with the margin removed by the additive method.
- Stake a quarter of Kelly, capped at 2 % of the bankroll.
- Two slip windows: hourly from six hours before kick-off, then every few minutes after team news, until five minutes
  before kick-off.
- Each slip names the match, the selection, the bookmaker, the price seen, the minimum price still worth taking, the
  stake and a deadline.

**The evidence.** It was tested out of sample on 2024-25 → 2026-27, 1,134 bets:
- **+5.7 % on turnover (t 1.33)**, positive in 4 of 5 half-seasons.
- The rule chosen in sample by a fixed procedure (edge ≥ 6 %, odds < 4): **+28.2 % on 201 bets (t 2.89)**.
- Walk-forward, season by season: **+15.9 % on 375 bets (t 2.29)**.

These are the best figures in this repository's search history, but they rest on football-data's closing snapshots. No
one can say those prices were there to click.

**Expected pounds in the first year.** Central case:
- 400 slips a year;
- a 5 % edge before the delay haircut;
- 12 accounts, each limited after a median 40 bets;
- a 5-minute delay between slip and click (70 % of slips still available, their edge cut by a fifth).

All figures are Monte Carlo means, with the 5th–95th percentile and the chance of a losing year:

| bankroll | (a) no limits, no delay, flat 2 % | (b) limits | (c) limits + 5-min delay, flat 2 % | (c) with ¼ Kelly capped at 2 % | sign-up offers, once |
|---|---:|---:|---:|---:|---:|
| £500 | £190 (−285 … 667; 26 %) | £135 | **£91** (−249 … 442; 33 %) | £52 (−70 … 178; 25 %) | ≈ £470 (£180–£780) |
| £1,000 | £380 (−570 … 1,334; 26 %) | £269 | **£182** (−498 … 884; 33 %) | £103 (−139 … 355; 25 %) | ≈ £470 |
| £5,000 | £1,899 | £1,345 | **£908** (−2,492 … 4,421; 33 %) | £516 (−697 … 1,775; 25 %) | ≈ £470 |

- Under limits, most accounts are used up in the first year. Two years together give £244 at £1,000 (case c).
- With no edge at all (ROI 0), case (a) at £1,000 reads −£18 (−951 … 927).
- The sign-up offers (§5) pay once, and they do not depend on the bankroll.

**Confidence: low.**
- The central edge sits 1.3 standard errors above zero on its own out-of-sample bets.
- The higher figures above come from rules chosen with the data in view.

**What kills it, in order:**
1. **The closing prices may never have been clickable.** football-data does not say when it captures each book's
   closing price. Two thirds of the procedure's bets were at a price the book had not changed since Friday. William Hill
   supplies 67 % of those bets, and its closing price equals its Friday price 31 % of the time, against 16–28 % at the
   others.
2. **Limits.**
   - Kaunitz et al. (2017): bookmakers "started to severely limit our accounts" a few months after they began betting
     $50 stakes. Their figures: 265 real-money bets over 5 months at +8.5 %, with stakes cut to $1.25–$24.
   - The Gambling Commission (July 2025): 4.31 % of 14.9 m active accounts were restricted. 46.8 % of the restricted
     ones were in profit, against 25.4 % of all accounts.
3. **Delay.** Kaunitz et al. found "around 30 % of the odds" on their dashboard "had already been changed" when a person
   went to place them.
4. **Anchor sensitivity.** On the same 10,641 matches, the 2 % rule made +2.3 % against the exchange and +0.3 % against
   Pinnacle.
5. **grokbot itself.** Bookmakers' terms generally forbid betting by automated means. An assistant that clicks may get
   accounts closed and winnings voided. That risk is Davies' to weigh; this design only writes slips.

**Polymarket.** It is a good fair-price source:
- its mid sat a median 0.5 point from Smarkets' where Smarkets' book was tight, and its spread was 3 ¢ against
  Smarkets' 8.9 points in thin leagues.

It is not a value venue: 3 of 351 outcomes were ≥ 2 % cheap, all where the fair price was unreliable.

As a lay leg it is cheaper than Smarkets only where Smarkets is thin:
- on tight books it cost +6.9 % more (median);
- hedging a value bet there gives most of the edge back.

**What to do first.** Run a paper phase (§7): slips are logged, nothing is staked, and closing-line value is measured.
Optionally, grokbot only reads each slip's price without betting, which measures availability. Before it can run, Davies
would need an odds-API key (The Odds API, $30–$59 a month) and to give his word for a recorder.

## 1. The strategy, chosen in sample and tested out of sample

### 1.1 Data and the fixed procedure

**Data.** football-data.co.uk, 22 divisions, 2021-22 → 2026-27: 40,163 settled matches (1,385 in 2026-27 so far).
Each match has a Friday/Tuesday "pre-closing" snapshot and a "closing" snapshot.

The UK books football-data carries change by season (`uk_books_by_season`):

| seasons | UK books carried |
|---|---|
| 2021-24 | Bet365, bwin, William Hill, VC Bet |
| 2024-25 | Bet365, bwin, William Hill |
| 2025-26 | Bet365, Betfred, BetMGM, BetVictor, bwin, Coral, Ladbrokes |
| 2026-27 | Bet365, Betfred, BetVictor, bwin, Paddy Power, Sky Bet |

Paddy Power and Sky Bet first appear in 2026-27, and STATARB-2's list missed them. "Max" and "Avg" are never used as a
venue: they include books a UK resident cannot use. Interwetten is left out.

**Anchors.**
- Pinnacle: present 2021-22 → 2025-07-25 … 2026-01-14 (2,964 of 2025-26's 7,646 matches), absent from 2026-27.
- The Betfair Exchange: present from 2024-25 on.
- Pinnacle closed its public API on 2025-07-23. Its documentation repository says access "has been closed for the
  general public since July 23rd, 2025".

**The procedure.** It is in `vbk_backtest.py`'s docstring, written before the script's first run:
- choose the de-vig method by log loss;
- choose the threshold θ and the odds cap on 2021-24, against Pinnacle, the only sharp price then;
- test on 2024-27 against the exchange, which is the anchor the design can actually read live;
- run a walk-forward;
- apply no league filter;
- test the other markets with the 1X2 pick.

### 1.2 De-vig method

| method | log loss, Pinnacle close 1X2, 2021-24 (23,420 matches) |
|---|---:|
| additive (equal margin off each outcome) | **0.99233** |
| power | 0.99237 |
| Shin | 0.99243 |
| odds-ratio | 0.99251 |
| multiplicative (proportional) | 0.99282 |

- Every method except the multiplicative takes more of the margin off longshots, which is the favourite-longshot bias.
  They are within 0.0002 of each other. Multiplicative is clearly worst.
- The same order holds against the bookmakers' average and the exchange in 2024-27.
- **Additive is the design's method.** Out of sample the choice moves little. At the procedure's cell against the
  exchange: additive +28.2 %, multiplicative +31.0 %, power +25.9 %, Shin +27.4 %, odds-ratio +26.1 %
  (`oos_smoothed_exc_by_method`).
- STATARB-2's "proportional gives only +1.32 %" was a different cell: Pinnacle anchor, all odds, θ 4 %. It is not a
  general verdict on the method.

### 1.3 Anchor

On the same 10,641 matches, at kick-off (`logloss_same_rows`):
- the bookmakers' average: 0.99827;
- the exchange: 0.99867;
- Pinnacle: 0.99872.

At the pre-closing snapshot:
- Pinnacle 1.00214 and the average 1.00241;
- the exchange 1.01414. A Friday exchange book is thin.

So at kick-off the three are equally good fair prices. On Friday the exchange is not one.

### 1.4 Threshold and odds cap

**In sample** (2021-24, Pinnacle anchor, grid of θ × cap; cells with ≥ 600 bets):
- the single best cell is θ 4 %, odds < 5: 1,543 bets, +14.7 %, t 4.15;
- the procedure's pick, the best 3×3 neighbourhood, is **θ 6 %, odds < 4**: 827 bets, +12.9 %, t 2.95.

**Out of sample, 2024-27** (`oos_*`):

| rule | anchor | bets | ROI | t | by season (bets, ROI) |
|---|---|---:|---:|---:|---|
| θ 6 %, < 4 (the pick) | **exchange** | 201 | **+28.2 %** | 2.89 | 24-25 145, +20.4 %; 25-26 52, +59.6 %; 26-27 4, −100 % |
| θ 6 %, < 4 | Pinnacle (to 2026-01) | 304 | +8.1 % | 1.03 | 24-25 +18.3 %; 25-26 −5.5 % |
| θ 6 %, < 4 | books' average | 163 | +31.3 % | 2.91 | +30.4 %; +34.8 % |
| θ 6 %, < 4 | exchange AND average both | 121 | +43.3 % | 3.52 | +41.9 %; +49.5 % |
| θ 4 %, < 5 (single best) | exchange | 440 | +10.9 % | 1.62 | +4.8 %; +24.4 %; +8.9 % |
| θ 4 %, < 5 | Pinnacle | 662 | +1.1 % | 0.21 | +6.2 %; −4.9 % |
| **θ 2 %, < 5** | **exchange** | **1,134** | **+5.7 %** | **1.33** | 24-25 +4.3 % (582); 25-26 +7.0 % (498); 26-27 +9.2 % (54) |
| θ 1 %, < 5 | exchange | 1,984 | +5.1 % | 1.61 | +4.4 %; +5.6 %; +6.9 % |

**Walk-forward** (each season's cell chosen on every season before it, with Pinnacle):

| season | rule | anchor | bets | ROI | t |
|---|---|---|---:|---:|---:|
| 2023-24 | θ 6 %, < 4 | Pinnacle | 189 | +6.3 % | 0.66 |
| 2024-25 | θ 6 %, < 4 | exchange | 145 | +20.4 % | 1.82 |
| 2025-26 | θ 8 %, < 4 | exchange | 38 | +55.3 % | 2.43 |
| 2026-27 | θ 8 %, < 4 | exchange | 3 | −100 % | — |
| **all** | | | **375** | **+15.9 %** | **2.29** |

The all-seasons row's worst drawdown is 10.1 units and its longest losing run 9 bets.

**The whole grid, out of sample** (cells with ≥ 50 bets):
- against the exchange, 58 of 58 cells are positive (median +10.9 %);
- against the average, 50 of 56 (median +8.9 %);
- against Pinnacle, 32 of 60 (median +0.5 %).

**The same matches under each anchor.** These are the 10,641 matches of 2024-26 carrying both Pinnacle's and the
exchange's closing prices:

| rule | Pinnacle | exchange | average |
|---|---|---|---|
| θ 2 %, < 5 | +0.3 % (1,204 bets) | +2.3 % (798) | +1.7 % (377) |
| θ 6 %, < 4 | +8.1 % (304) | +21.8 % (158) | +30.9 % (133) |

Every anchor lost on the first half of 2025-26 (the only stretch of that season with Pinnacle). So part of the exchange
rules' lead is when they were measured, not how.

### 1.5 How often it fires, and the choice made after seeing it

Bets per 1,000 matches against the exchange, by season (`bet_rate_by_season_exc_close`):

| rule | 2024-25 | 2025-26 | 2026-27 |
|---|---|---|---|
| θ 6 %, < 4 | 18.9 | 6.8 | 2.9 |
| θ 2 %, < 5 | 75.8 (ROI +4.3 %) | 65.1 (+7.0 %) | 39.0 (+9.2 %) |

The high-threshold rule's bets were mostly William Hill's: 135 of 201. William Hill leaves the files in 2025-26, and the
rule nearly stops firing. The 2 % rule fires steadily at every book set. Its half-season ROIs are +7.8, −2.5, +3.4,
+12.4 and +9.2 %.

**The design therefore uses θ 2 %, odds < 5, staked by quarter-Kelly** (§1.9), so a larger edge gets a larger stake.
**This choice was made after the out-of-sample results were seen**: it is disclosure 1 in §7.

### 1.6 Which books, and whether their prices were real

**William Hill dominates.** It supplies:
- 642 of the 827 in-sample bets;
- 135 of the 201 out-of-sample bets;
- 420 of the 2 % rule's 1,134 (then Bet365 270, BetMGM 207, BetVictor 95, Betfred 74).

**Stale prices.** Each book's closing price equals its Friday price at these base rates
(`book_close_equals_pre_base_rate`):

| book | unchanged |
|---|---:|
| William Hill | 31.3 % |
| Betfred | 27.5 % |
| BetMGM | 22.5 % |
| Coral | 22.4 % |
| Ladbrokes | 22.0 % |
| Bet365 | 19.7 % |
| bwin | 18.2 % |
| BetVictor | 18.1 % |
| VC Bet | 17.3 % |
| Sky Bet | 16.4 % |
| Paddy Power | 15.8 % |

Among the procedure's bets, the share is 66.8 % (exchange anchor, 196 with a Friday price) and 71.8 % (Pinnacle anchor,
in sample).

Both halves made money:
- unchanged prices: 136 bets, +25.2 % (t 2.15);
- moved prices: 65 bets, +34.4 % (t 1.95).

Without William Hill, the procedure's rule keeps 66 bets at +34.0 % (t 1.91) out of sample, and 213 at +23.6 % (t 2.56)
in sample.

**Profit is in the big edges.** By edge band, against the exchange:

| edge at the bet | bets | ROI | t |
|---|---:|---:|---:|
| < 8 % | 74 | +12.6 % | 0.78 |
| 8–12 % | 73 | +25.0 % | 1.55 |
| 12–20 % | 40 | +44.6 % | 2.13 |
| ≥ 20 % | 14 | +80 % | 2.08 |

A 12 % edge at a UK book at kick-off is a price the book has not updated. football-data's notes name its sources
("Betbrain.com, Oddsportal.com, and individual bookmakers") but not when a closing price is captured. A price an
aggregator stopped refreshing would look exactly like this. **Only a forward record of prices actually offered can
separate a stale book from a stale scraper** (§7).

### 1.7 Leagues

- Whether a division's in-sample ROI predicts its out-of-sample ROI could be measured on only 5 divisions: Spearman −0.2.
  So no league filter is applied.
- The Odds API lists 18 of the 22 divisions. It lacks the National League and Scottish divisions 1–3, which hold 26 % of
  the 2 % rule's bets.
- Live, the rule covers 74 % of the backtest's bets.

### 1.8 Other markets and the Friday window

**Over/under 2.5 and Asian handicap.** football-data carries one UK book for these, Bet365. No in-sample cell reached
600 bets, so the 1X2 pick was carried over:

| market and snapshot | in sample (Pinnacle) | out of sample (exchange) | out of sample (Pinnacle) |
|---|---|---|---|
| O/U at kick-off | 14 bets, −25.5 % | 25 bets, +7.4 % | — |
| AH at kick-off | 65 bets, +16.9 % | 51 bets, +30.7 % (t 2.16) | 185 bets, −1.9 % |
| AH on Friday | 456 bets, +10.9 % (t 2.62) | 341 bets, +6.7 % (t 1.41) | — |
| O/U on Friday | 275 bets, +0.2 % | 799 bets, −5.9 % | — |

The rule for AH on Friday is θ 1 %, odds < 5. **These markets stay out of the first design.** They are logged
descriptively in the paper phase: one book, and the samples are small.

**The Friday window** (rule θ 1 %, odds < 5; closing-line value, CLV, is the bet's price × the closing fair − 1):

| anchor | period | bets | ROI | t | CLV |
|---|---|---:|---:|---:|---|
| Pinnacle | 2021-24 | 2,410 | +5.6 % | 1.93 | +2.2 % against Pinnacle's close |
| books' average | 2024-27 | 311 | +5.1 % | 0.68 | **+3.25 % against the exchange's close, 67 % of bets positive** |
| Pinnacle | 2024-27 | 941 | +2.3 % | 0.50 | +0.5 % |
| exchange | 2024-27 | 2,365 | −1.6 % | −0.55 | thin Friday books |

Kaunitz et al.'s minute-by-minute simulation found the same thing. Betting the consensus outlier 1–5 hours before
kick-off made +9.9 % on 6,994 bets. That window has hours of slack for a clicker.

### 1.9 Staking

These replays are scale-free, so they hold at any bankroll. "Kelly" is the fraction of the bankroll at the start of the
bet's day, from the anchor's fair price (`vbk_bankroll.json` → `replay`).

| bets | rule | staking | bets a year | growth a year | max drawdown | longest losing run | turnover a year | ROI on turnover |
|---|---|---|---:|---:|---:|---:|---:|---:|
| θ 2 %, < 5 (1,134) | 2024-07 → 2026-10 | flat 1 % | 519 | +25.6 % | 27.8 % | 16 | 5.2× | +5.7 % |
| | | flat 2 % | 519 | +46.1 % | 42.6 % | 16 | 10.4× | +5.7 % |
| | | **¼ Kelly, cap 2 %** | 519 | **+51.9 %** | **11.3 %** | 16 | 5.3× | **+12.9 %** |
| | | ½ Kelly, cap 5 % | 519 | +144 % | 21.7 % | 16 | 19.3× | +14.3 % |
| walk-forward (375) | 2023-08 → 2026-09 | ¼ Kelly, cap 2 % | 120 | +36.4 % | 13.5 % | 9 | 2.4× | +21.5 % |
| the pick (201) | | ¼ Kelly, cap 2 % | 94 | +48.8 % | 8.2 % | 5 | 2.0× | +31.8 % |

Quarter-Kelly doubles the return on turnover against flat stakes on the same bets, +12.9 % against +5.7 %, because the
larger edges won more (§1.6). It also cuts the worst drawdown from 43 % to 11 %. **Every growth figure here is a
historical replay of prices that may not have been clickable; §2 is the planning number.**

## 2. Annualised return on a real bankroll

### 2.1 The scenarios and where each number comes from

| input | low / central / high | source |
|---|---|---|
| slips a year | 250 / **400** / 550 | the 2 % rule fired 519 a year at 3–7 books; 74 % of its bets are in leagues the Odds API covers; live, about 19 UK books instead of 3–7 |
| ROI before delay | 0, 3 % / **5 %** / 8 % | out of sample +5.7 % (SE 4.3); STATARB-2 +5.83 %; Kaunitz real money +8.5 %, paper +5.5 % |
| accounts and lifetime | 12 accounts; median **40** placed bets each (15 / 120); lognormal, σ 0.7 | Kaunitz: limits a few months in, 265 bets in 5 months; UKGC: 59 % of stake-factored accounts held to ≤ 9 % of the normal stake, 22.4 % to ≤ 1 % |
| delay | 2 / **5** / 10 min: 85 / **70** / 55 % of slips still at their minimum price; the survivors' ROI × 0.9 / **0.8** / 0.7 | Kaunitz: 30 % already changed; §2.3 |

How limits are modelled:
- A slip falls on a book by the backtest's book shares (65 %) or on one of 3 books the data does not carry (35 %).
- A limited account's slips are lost, never redirected.
- Stakes are flat 2 % of the starting bankroll, or quarter-Kelly capped at 2 %.
- 4,000 runs per cell (`vbk_bankroll.json` → `plan`).

### 2.2 The pounds

At £1,000; £500 is half and £5,000 five times, since every stake scales with the bankroll. Each cell gives the mean,
the 5th–95th percentile and the chance of a losing year.

| case | year 1 | bets placed |
|---|---|---:|
| (a) no limits, ROI 0 | −£18 (−951 … 927), 51 % | 400 |
| (a) no limits, ROI 3 % | £220 (−726 … 1,175), 36 % | 400 |
| (a) no limits, ROI 5 % | £380 (−570 … 1,334), 26 % | 400 |
| (a) no limits, ROI 8 % | £620 (−327 … 1,599), 14 % | 400 |
| (a) ¼ Kelly capped at 2 %, ROI 5 % | £209 (−129 … 552), 15 % | 400 |
| (b) limits, fast (median 15 bets) | £139; two years £170 | 154 |
| (b) limits, central (median 40) | £269; two years £366 | 281 |
| (b) limits, slow (median 120) | £368; two years £654 | 379 |
| (c) limits central + 2-min delay | £236 | 255 |
| **(c) limits central + 5-min delay** | **£182 (−498 … 884), 33 %; two years £244** | 225 |
| (c) limits central + 10-min delay | £132 | 190 |
| (c) 5-min delay, ¼ Kelly capped at 2 % | £103 (−139 … 355), 25 % | 225 |

**Reading the table.**
- At these bankrolls VB-K is a few hundred pounds a year, and then the accounts are gone.
- The spread is wider than the mean: a losing first year has about one chance in three.
- At £5,000, a flat 2 % stake is £100 a bet. That is near what UK books accept on lower-league matches before any limit,
  and it attracts a limit sooner. Nothing above models a stake refused for size.
- The money also has to be spread over 12 accounts. At £500 that is about £40 each.

### 2.3 How much edge survives the delay

- **The fair price hardly moves in the last minutes.** On Polymarket's minute history for 315 closed games (60 days; La
  Liga 68, EPL 50, Championship 39, Ligue 1 39, Bundesliga 36, Nations League 32, others; `pm_drift_2026-10-09T1941Z.json`):

  | window | mean move | games moving ≥ 2 ¢ |
  |---|---:|---:|
  | 10 minutes to five minutes before kick-off | 0.27 ¢ | 2.5 % |
  | 5 minutes, same end | 0.16 ¢ | 0.6 % |
  | 10 minutes, an hour earlier, when team news lands | 0.33 ¢ | 7.0 % |

  After a one-minute jump of ≥ 2 ¢ (19 jumps), the next 10 minutes continued in 53 % and reversed in 21 %. A 2–6 % edge
  is not eroded by the fair price moving.
- **What erodes it is the bookmaker correcting its own price.** No UK book publishes minute history keylessly, so that is
  unmeasured.
- **The evidence on that correction:**
  - two thirds of the procedure's bets were prices left unchanged since Friday (§1.6), which a book that has not moved
    for days is unlikely to move in the next five minutes;
  - Kaunitz et al. found 30 % of dashboard prices already gone by the time a person checked.

  The 5-minute scenario (70 % survive, edge × 0.8) sits between the two.
- **The feed's own lag adds to the delay.** The Odds API refreshes featured pre-match markets every 60 s and exchanges
  every 20 s, both shortening within six hours of the start. A slip is at most about a minute old when written.
- **The Friday and morning windows** carry CLV of +3.25 % against the exchange's close (§1.8). They give grokbot hours
  rather than minutes.

## 3. Data feeds for live operation

| source | what it gives | cost and terms | verdict |
|---|---|---|---|
| **The Odds API** (the-odds-api.com) | one call per league returns every match's prices. `uk` region, 21 books: 888sport, Betano, Betfair Exchange, Betfair Sportsbook, Betfred, BetVictor, Betway, BoyleSports, Casumo, Coral, Grosvenor, Ladbrokes, LeoVegas, LiveScore Bet, Matchbook, Paddy Power, Sky Bet, Smarkets, Unibet, Virgin Bet, William Hill. `eu` region includes `pinnacle` ("from public website which may incur a delay"), Betfair Exchange EU and Matchbook. 18 of the 22 divisions | 1 credit per region per market per call. Free 500/month; $30 for 20 K; $59 for 100 K. A key by e-mail: **Davies' sign-up** | **the feed the slip generator needs** |
| Betfair Exchange API | the deepest UK exchange | a funded, KYC-verified Betfair account. Delayed key free (1–180 s snapshots, 3 price levels). Live key £299 once (Betfair's developer pages). Commission not verified at source here | not needed: the Odds API carries Betfair's exchange prices |
| Smarkets `/v3` | exchange quotes, keyless (measured: 752 football events in the next 72 h) | free; read-only | a fallback anchor. Its football books were a median 8.9 points wide three days out in the leagues matched |
| Pinnacle | the sharpest book | public API closed 2025-07-23; resellers $20–$1,000+ a month (not verified) | through the Odds API's `eu` region only |
| Polymarket Gamma + CLOB | 1X2 as three binary markets per match, in EPL, Championship, League One and Two, La Liga, Bundesliga, Ligue 1, Scottish Premiership and many more; minute price history | keyless | a fair-price component and the measuring tape (§4) |

**The cheapest robust setup.**
- The Odds API with regions `uk,eu`, market `h2h`: 2 credits a league a poll.
- 2025-26 had 87 kick-off slots a week in the covered leagues.
- Each slot is polled 3 times early, every 5 minutes from T−50 to T−5, and once at kick-off for the close: about 15 polls,
  so 2,600 credits a week and 11,300 a month. The $30 plan covers it.
- Polling every 2 minutes in the late window needs about 22,000 a month, on the $59 plan.
- Smarkets and Polymarket are read keylessly beside it, every minute in the last hour.

## 4. Polymarket: measured against Smarkets now

The snapshot was taken at 19:33 UTC on 2026-10-09, an international-break weekend (`live_snapshot_2026-10-09T1933Z.json`):
- Polymarket had 179 soccer match events with kick-off in the next 72 h, and Smarkets 752;
- 119 matched on date and both team names, across 30 leagues;
- each match is three binary markets, all `sports_fees_v3`: rate 0.05 × p(1−p) a share, taker only.

| measure | all outcomes (351) | where Smarkets' book is ≤ 2 points wide (11) |
|---|---|---|
| \|Polymarket mid − Smarkets fair\| | median 0.65 pt, p75 1.1, max 5.3 | median 0.5 pt, p90 1.2 |
| spread | Polymarket 3 ¢; Smarkets 8.9 points | Polymarket 2 ¢ |
| depth | $84 within 1 ¢ of Polymarket's ask; £196 at Smarkets' best offer | $191 |
| value: fair ÷ (ask + fee) − 1 | median −7.4 %; ≥ +2 % on 3 outcomes, all where Smarkets was 9–17 points wide | median −5.9 %, best −2.1 % |
| lay cost (loss per unit won), Polymarket NO against Smarkets lay | Polymarket cheaper on 82 % | **Polymarket cheaper on 18 %, median +6.9 % dearer** |

What this says about each role:
- **(i) A value venue: no.** Polymarket's soccer prices sit on the exchange's. Its ask plus the fee is 5–7 % above fair.
- **(ii) A hedge: rarely worth it.** To lock a profit, a back at the bookmaker at fair × (1 + e) needs a Polymarket NO at
  about (1 − p) + half the spread + the fee. At p 0.4 that locks −0.8 % for e = 5 % and +0.3 % for e = 8 %. Hedging hands
  back most of the edge it was meant to protect, and it adds a USDC leg, an FX conversion, settlement delay and the
  Ireland-only rule. The value bet's edge is its expected value: leave it unhedged. Where Polymarket does beat Smarkets is
  the lay leg of a free bet in a thin league (§5).
- **(iii) A fair-price source: yes, as a component.** Its mid agrees with the exchange to half a point where the exchange
  is liquid. It is keyless, minute-fresh, and its spread is narrower than Smarkets' in the thin leagues where the slips
  mostly fall. The design logs it beside the exchange and the consensus, and the paper phase measures it as an anchor;
  no Polymarket-anchored rule exists in the backtest.
- **Automation.** This repo's Polymarket order path could place such legs in principle (eu-west-1, Davies' attestation).
  Nothing here recommends it: no hedge pays, and the bookmaker leg is grokbot's.

## 5. Sign-up offers and reloads (matched betting) as part of the pipeline

**How much a free bet keeps.** A stake-not-returned free bet keeps (B − 1) ÷ (1 + r) of its face value:
- B is the bookmaker's odds;
- r is the lay leg's loss per unit it wins.

On the snapshot's books (`vbk_matched.json`; B is the Smarkets fair × 0.95, an assumed 5 % book margin; outcomes at fair
odds 2.5–8):

| books | lay leg | kept | qualifying bet's loss |
|---|---|---:|---:|
| tight Smarkets books (≤ 3 points) | Smarkets | 66.0 % | 9.3 % |
| | Polymarket | 61.8 % | 13.2 % |
| all 238 outcomes | Smarkets | 55.1 % | — |
| | Polymarket | 61.6 % (better on 79 %) | — |

These are thin-league books three days out. A matched bettor picks the closest back/lay pair on a liquid exchange and
keeps more; 66 % is the floor used here.

**One-off sign-up value.** The arithmetic of `signup_plan`:
- 15 offers × £20 free bets: £184 (low);
- **25 × £30: £472 (central)**;
- 35 × £35: £776 (high).

Offer sizes are the ones advertised in 2025–26: bet £10, get £30 (BetUK), £40 (BetMGM), £30 for £5 (Ladbrokes). About
20 minutes an offer, so about 8 hours for the central case.

**Reloads.** Weekly offers for existing customers were not quantified: no keyless record of them exists.

**How it joins the pipeline.**
- grokbot clicks either kind of slip. A bonus slip is a back at the bookmaker plus a lay at Smarkets or Betfair, both
  legs on one slip with their stakes.
- Order matters: take each book's sign-up offer when the account is opened, then use the account for value slips.
- A book that restricts an account for value betting also ends its offers. One that restricts promotions for "bonus
  abuse" usually leaves the stakes.
- Each account is spent once.
- UK bookmaker winnings are untaxed for a UK resident. Polymarket gains were not checked for tax.

## 6. The design

### 6.1 Inputs, each minute (one Edge call on the minute job, its own `edge_calls` row and beat)

- **Odds API, read due leagues only.** For leagues with a kick-off in the next six hours, call
  `/v4/sports/<league>/odds?regions=uk,eu&markets=h2h&oddsFormat=decimal` when a poll is due. The function keeps each
  book's price and `last_update`.
- **Smarkets.** The full-time-result quotes of the same matches. The function reads the event list once an hour and the
  quotes every minute in the last hour.
- **Polymarket.** The three moneyline books of the same matches, where they exist.
- **The key.** An Odds API key Davies makes and stores in Supabase secrets, never printed. It is verified read-only by
  the `probe` action before anything depends on it, as with every key here.

### 6.2 The rule, as the slip generator applies it (version `vbk-1`)

- **Fair.** The Betfair Exchange's prices (`betfair_ex_uk`), de-vigged additively.
  - If Betfair's `last_update` is over 2 minutes old or its book is missing, use Smarkets' mid.
  - If that is wider than 3 points, write no slip.
  - The consensus (every `uk` + `eu` book, Pinnacle included) and Polymarket's mid are recorded beside it, not used.
- **Candidate.** For each outcome, the best price among the books Davies holds an unlimited account at, from the `uk`
  region only (no `eu` book: those are not his). The edge is price × fair − 1.
- **Slip.** Written when edge ≥ 2 %, odds < 5, and the book's `last_update` is ≤ 2 minutes old.
- **Stake.** ¼ Kelly, (p × o − 1) ÷ (o − 1) ÷ 4 × the bankroll, capped at 2 % of the bankroll and floored at £2. It is
  rounded down to £1.
- **Minimum odds.** The price at which the edge against the slip's fair falls to +1 %: 1.01 ÷ p, rounded up to the
  book's tick.
- **Windows.**
  - *early*: polls at T−6 h, T−3 h and T−90 min; deadline 60 minutes after the slip.
  - *late*: every 5 minutes from T−50 to T−5 min; deadline the sooner of 10 minutes after the slip and T−2 min.
- **One slip per match, outcome and book.** A later poll updates the price and the stake on the open slip, never adds a
  second.
- **Not for now.** Over/under and Asian handicap are logged as descriptive candidates, without slips.

### 6.3 What grokbot reads

A page on the site (the Agents page, a "VB-K slips" view, paper first). The same rows are served as JSON by the function's
`?action=vbkslips`. A slip:

```json
{
  "slip_id": "vbk-20261017-E1-burnley-coventry-H-williamhill-1",
  "rule": "vbk-1", "window": "late", "created_at": "2026-10-17T13:52:05Z", "expires_at": "2026-10-17T13:58:00Z",
  "kickoff": "2026-10-17T14:00:00Z", "league": "Championship", "match": "Burnley v Coventry",
  "market": "Match result (1X2)", "selection": "Burnley", "bookmaker": "William Hill",
  "odds_seen": 2.30, "min_odds": 2.12, "stake_gbp": 14,
  "fair_p": 0.4762, "edge": 0.0952, "anchor": "betfair_ex_uk", "anchor_age_s": 31, "book_age_s": 44,
  "also": { "consensus_p": 0.4705, "smarkets_mid_p": 0.4790, "polymarket_mid_p": 0.47 },
  "status": "open"
}
```

**The HTML view.** One row per open slip: deadline countdown, match, selection, bookmaker, odds seen, minimum odds and
stake, largest first. Expired slips are greyed out and stay visible.

**grokbot's answer, per slip.** grokbot (or Davies) records one of:
- `placed`, with `odds_obtained`, `stake_accepted` and `placed_at`;
- `price_gone`, with the price shown;
- `stake_limited`, with the maximum offered;
- `account_restricted`;
- `skipped`.

Writing back is a small authenticated form on the page, with the admin token. A `stake_limited` or
`account_restricted` answer takes that book out of the candidate set the same minute.

### 6.4 Bankroll and stop rules

- **The bankroll.** It is the money placed at the books plus the cash set aside for VB-K, entered by Davies. The page
  never reads a bookmaker balance.
- **Exposure caps.** At most 10 % of the bankroll open at once, and at most 3 % on one match.
- **Losses.**
  - Stop all slips at a 30 % drawdown from the starting bankroll.
  - Halve stakes at 15 %.
- **CLV stops.**
  - After 150 placed bets, stop if the mean closing-line value of the odds obtained is ≤ 0.
  - After 300, stop if it is below +1 %.
- **Per book.** Pause a book after its first `stake_limited`. Drop it after an `account_restricted`, or after two
  stake-limited answers in a week.

### 6.5 Records, so the result is honest

Four tables, write-once except where noted:

| table | holds |
|---|---|
| `vbk_slips` | every slip as first written, and each later update as a new version |
| `vbk_answers` | grokbot's or Davies' answer, one per slip |
| `vbk_closes` | each match's prices at T−1 min and at kick-off: Betfair, Smarkets, Polymarket, consensus, and every book a slip named |
| `vbk_results` | the full-time result and each slip's settled profit |

The page reports on every slip written, not only the ones placed:
- **slip CLV**: odds seen × closing fair − 1;
- **fill CLV**: odds obtained × closing fair − 1;
- **availability**: the share of slips placed at ≥ minimum odds;
- **ROI** on placed stakes;
- each by window, book and league.

A slip never leaves the record: an expired, skipped or limited slip is a row of the denominator.

### 6.6 What it is not

- This repository never logs in to, scrapes, or places anything at a bookmaker. grokbot is Davies' own tool in his own
  accounts.
- Bookmakers' terms generally forbid automated betting. An AI browser assistant clicking for him may breach them,
  with accounts closed and bets voided. That is his decision, made knowingly. A slip page a person clicks through
  himself carries the same edge.
- Nothing above is built. It needs the Odds API key and his word: a migration, an Edge Function, a page and their docs.

## 7. Pre-registration draft: VB-K paper (not frozen)

Following `TEMPLATE-variant-prereg.md`'s sections. VB-K is not a twin row: it needs its own build, then this page frozen
with it.

**0. On whose word.**
- Davies, 2026-10-09 (quoted at the top). The paper phase stakes nothing.
- It needs from him: an Odds API key he creates and stores; his word for the recorder; and, for arm L's availability
  checks, his word that grokbot opens slips at his books to read the offered price without betting.

**1. What it is.**

| | arm E (early) | arm L (late) |
|---|---|---|
| rule | `vbk-1`, §6.2 | `vbk-1`, §6.2 |
| polls | T−6 h, T−3 h, T−90 min | every 5 min, T−50 → T−5 min |
| stake | ¼ Kelly on a notional £1,000, never placed | the same |
| leagues | the Odds API's 18 of the 22 football-data divisions | the same |
| books | the `uk` region's sportsbooks | the same |

**2. Why.**
- §1.4: the 2 % rule made +5.7 % out of sample (t 1.33) at kick-off.
- §1.8: the consensus-anchored Friday rule carried +3.25 % CLV against the exchange's close.
- What no backtest can show: whether these prices exist when a person or grokbot arrives.

**3. Window, reading and bar.**
- **Window.** From the first slip after the freeze (a UTC instant to be stated) to the later of 2027-01-31 and 300
  slips per arm.
- **Reading.** On or after 2027-02-01, by a script frozen with this page. The page shows the running figures from day
  one: there is no no-peek rule, and the report says the reading was not blind.
- **Bar, arm E.** Mean slip CLV (odds seen × the Betfair close's additive-de-vigged fair − 1) ≥ +2.0 %, with the lower
  end of its 95 % interval above 0, over ≥ 300 slips.
- **Bar, arm L.** Two parts:
  - on ≥ 100 grokbot read-only checks, the offered price is ≥ the slip's minimum odds within 5 minutes of the slip on
    ≥ 60 % of checks (Kaunitz et al.'s 70 % is the reference);
  - the CLV of the price grokbot saw is ≥ +2.0 % on average.

  Without checks, arm L is descriptive.
- **Descriptive in both.** Settled ROI on notional stakes, by book, league and window; the Polymarket-mid and consensus
  anchors' log loss against Betfair's; over/under and AH candidates.
- **Passing means** the case for staking real money goes to Davies with the measured availability and CLV. It does not
  mean the money is staked.
- **Health, daily.** The function's beats, the Odds API's `x-requests-remaining`, slips written per match day against the
  backtest's 65–76 per 1,000 matches, and closes captured on ≥ 95 % of slipped matches.

**4. Its record before now.** §1, in sample. The 2 % threshold, the odds < 5 cap and Kelly staking were chosen with the
2024-27 results in view.

**5. Frozen files.**

| file | sha256 |
|---|---|
| the slip generator's Edge Function, its migration and the reading script | to be written |
| `docs/agents/backtests/vbk/scripts/vbk_backtest.py` and its results | in `MANIFEST.json` |

**6. Disclosures.**
1. Every figure in this document was seen before the freeze.
2. θ 2 % and odds < 5 were chosen after the out-of-sample table (§1.5).
3. The fixed procedure's own pick, θ 6 %, odds < 4, is reported, not used.
4. The additive de-vig was chosen by in-sample log loss, before any betting result.

## 8. What was not done or not checked

- **Account limits, stake sizes and their timing at each UK book.** Not measured. The model's 40-bet median is a
  scenario resting on Kaunitz et al. and the UKGC's aggregate figures, which give no timing.
- **When football-data captures closing prices.** Not stated by football-data. Whether its closing UK prices were
  clickable is the central open question (§1.6).
- **No UK bookmaker's live prices were read.** Doing so needs the Odds API key. The matched-betting arithmetic assumes a
  5 % book margin.
- **The Polymarket snapshot is one read on an international-break weekend.** It holds 11 tight-book outcomes, so its lay
  and value figures are small-sample. Polymarket's price history is in 1 ¢ steps.
- **Not verified at source:** Betfair's commission; the Pinnacle resellers' terms; the bwin UK licence (an affiliate page
  gives number 39372); UK tax on Polymarket gains.
- **Weekly reload offers** were not quantified.
- **Over/under and Asian handicap** rest on Bet365 alone.
- **The interview showcase** (`showcase/daviesportfolios/README.md`) was not updated. VB-K is a design, not a strategy
  row.
- **Nothing was placed, cancelled, funded or signed up for.** No production table was read.

**Sources outside the repository:**
- Kaunitz, Zhong & Kreiner, "Beating the bookies with their own numbers" (arXiv:1710.02824);
- the Gambling Commission, "Commercial restrictions by betting operators" (blog, 2025-07-23);
- github.com/pinnacleapi/pinnacleapi-documentation;
- the-odds-api.com (plans, bookmaker regions, update intervals, sports list);
- Betfair's developer documentation (application keys);
- football-data.co.uk/notes.txt.

## Files

- `docs/agents/backtests/vbk/`: scripts, inputs (the live and drift snapshots), results, and `MANIFEST.json`.
