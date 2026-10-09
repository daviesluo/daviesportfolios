# STATARB-2: a second stat-arb search, any statistical edge, any platform (2026-10-09)

Davies, 2026-10-09, after the first search (`reviews/2026-10-09-stat-arb-search.md`): "除了这三个还有别的好的吗？还有别的统计套利吗？而且不一定要和现有策略类似的".
So this search drops the first one's generator (an anchor, a retail crosser, a free maker, a barrier) and asks for any
statistical edge on any platform. Compliance is set aside for the search, as before, but every candidate names what
stands in the way of a UK or Ireland resident (§2, last column). Kalshi stays ruled out (Davies: "我开不了Kalshi的账户").

**What this is.** It is research only, on keyless public data. Nothing was traded, opened, funded or signed up for. No
key was made or read, no production table was read, and nothing here recommends a VPN, a proxy or anyone else's
account. No pre-registration was frozen: the three in §4 are drafts.

**Sources.** Every figure comes from `docs/agents/backtests/statarb_search2/`: its scripts, the inputs they read and its
results, each file with its sha256 in `MANIFEST.json`. Five scorers (`vb_football.py`, `eq_dual_adr.py`, `eq_pairs.py`,
`fx_weekend_fix.py`, `fx_yahoo_check.py`) were each run three times from the committed inputs and gave the same bytes.
The snapshots (`deribit_parity_vrp.py`, `funding_xvenue.py`, `defi_lending.py`, `lrt_discount.py`) read live data and
commit what they read. A re-run reads a later book.

**How the rules were fixed.** Each scorer's rule is in its docstring, written before its first run. Four changes came
after a first look, and each is named where it is used:
- VB's power de-vig and odds bands, added because proportional de-vigging overstates longshots;
- VB's exchange anchor, added because Pinnacle's odds are missing from 2026-27;
- FXW's arm without a take-profit;
- FXW's check on Yahoo's feed.

## 1. Already covered here, so not repeated

Several ideas on Davies' list were already measured in this repo:
- **Polymarket's internal arbitrage**, fp4 (`reviews/2026-09-24-polymarket-fp4-study.md` §3–§4):
  - YES + NO is one book (400 of 400 markets);
  - negative-risk sets away from 1 were three sweeps of 7,104 events, whose only "edges" were resolution clauses read as
    prices (M5);
  - 896 strike and date ladders gave 16 violations, the largest 0.93 ¢ (M6);
  - resolution timing (B4, M2) and hourly and 15-minute up/down markets against Binance (M3b, B7) are dead too.
- **Cross-venue basis, funding carry and crowding**: §2c, §3.34, fp6 H1–H3. FUNDX below adds only the cross-venue spread.
- **Stablecoin de-peg lotteries** (fp1), and **stETH against Lido's queue** (the first search, §4.5).
- **MSTR and BMNR against NAV** (§3.45), and **US-equity calendar effects** (EQ1, DFC).
- **Weather, view-count and post-count markets** (WX, PMLATE, VIEWS), and **TAKE** and **rule D** (the PR5 variants).

## 2. The ranked list

Ranking is expected edge × feasibility for a UK/Ireland resident at $100–$10,000, in this repo's setup: the Supabase
minute loop, pg_cron to 1 s, a Cloudflare Worker below that. "Dead" means the measurement says so. "Not measured"
means no keyless data could test it, and the reason is given.

| # | candidate | mechanism | venue · cost | measured | capacity at $100–$10k | speed | main risk | what stands in Davies' way | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **VB-K: value bets at UK bookmakers against the exchange's price at kick-off** | soft books lag a sharp price; bet when best UK price × sharp fair − 1 ≥ 2 % | Bet365, Betfred, BetMGM, BetVictor, bwin, Coral, Ladbrokes, William Hill, VC Bet · no fee (the margin is in the price) | exchange anchor, odds < 5: **+5.83 % ROI on 1,133 bets** (t 1.37), positive in 2024-25 (+4.6 %), 2025-26 (+7.3 %) and 2026-27 so far (+5.2 %). Pinnacle anchor, θ 4 %: **+6.88 % on 2,645 bets, t 2.20**, four seasons of five positive (2025-26 −10.3 %). Every outcome at the best UK price: −5.5 % | about 500 bets a year in 22 divisions; at £20 a bet about £600 a year (± £650, one SE), until the books limit the account | minutes before kick-off: a minute loop is enough if the odds feed is minute-fresh | **bookmakers restrict or close winning accounts**; the result's sign rests on the de-vig method (proportional: +1.3 %, t 0.37) | legal for a UK resident and untaxed; most bookmakers' terms forbid automated betting, so bets are placed by hand; a live soft-book odds feed is not keyless (an odds API key, Davies' sign-up) | **the strongest statistical edge measured here; the forward test needs no build** (§4.1) |
| 2 | **FXW-AUD: fade AUD/USD's Sunday-open gap** | a weekend gap of ≥ 20 bps partly reverts in the first hours | a UK spread-bet or CFD broker · FXCM's own Sunday-open spread (median 8.35 bps) + 1 bp exit | FXCM 1-minute bid/ask 2016 → 2026: **+21.84 bps a trade on 85 weekends, t 5.58, 10 of 11 years positive**; without the take-profit +20.0 (t 3.04); entered an hour later +8.1 (t 1.11). EUR +7.6 (t 1.39), GBP −6.5, JPY −3.4. On Yahoo's feed, entered 1–2 h after the open: AUD +20.8 (t 1.72, n 28) | about 8 trades a year; on $50k notional about $870 a year (margin about $2.5k at 20:1) | the Sunday open minute (about 21:00–22:00 UTC): pg_cron at 1 s | **the edge lives in the first hour, when a retail broker's quote may not be FXCM's**; it was found among 32 arms; the two feeds' gaps correlate only 0.24–0.46 | spread bets and CFDs are legal for UK retail, with a 20:1 margin cap on a non-major pair; UK spread-bet profits are untaxed | **real on one feed; needs one broker's Sunday-open quotes before anything else** (§4.2) |
| 3 | DCS: hold the cheaper class of a dual-class company | the A/B spread reverts (half-life 8–17 days) | US-listed dual classes at a USD account · 5–35 bps a switch | 8 pairs, 2016 → 2026, k 1 %, 20 bps a switch: **+0.59 %/yr on the holding** (mean of the 8; BF-B/BF-A +2.04 %, FOXA/FOX +0.47 %, GOOGL/GOOG +0.25 %), last two years +0.26 % | proportional to a holding Davies already wants; at $10k, tens of dollars a year | a daily close | thin classes (MOG-B traded on 181 of its last 500 days: void) | none for a USD account; whether Trading 212 lists each class is unverified | **an overlay for an existing holding, not a strategy** (§4.3) |
| 4 | LRT: rETH below its own rate | a redemption anchor | Ethereum DEXs via an aggregator | rETH sells **31–32 bps** under its rate at 10 and 100 tokens; wstETH 2.1, weETH 1.7–1.9, cbETH 11 (and 879 at 100: a thin book) | thin | — | redeeming at the rate needs ETH in Rocket Pool's deposit pool (not checked); otherwise the discount is a hold | a wallet; no UK bar | **descriptive**: a discount without a dated exit is not an arbitrage |
| — | PAIRS: distance-method pairs on 94 large US names | textbook stat arb | a margin account (broker borrow) or CFDs | 21 overlapping periods 2016 → 2026, 467 trades: **−0.69 %/yr gross**, −1.29 % with broker borrow, −3.10 % as CFDs | — | daily | — | shorting needs a margin account or CFDs; T212's key here is read-only | **dead** (and survivorship flatters it) |
| — | ADRX: UK ordinary against its US ADR | the same company on two lines | LSE + NYSE at a GBP account · a switch round trip 0.80 % (2 × 0.15 % FX + 0.5 % stamp duty) | 12 ADRs, 59 days of 5-minute bars in the overlap: deviations from the 5-day median have sd 8.6–32.1 bps; bars beyond 80 bps on a day that was not shifted whole: **0–3 per name**. The whole-day shifts are ex-dividend dates that differ between the lines | — | — | — | stamp duty | **dead** |
| — | FIX: reversal after the London 4 pm fix at month end | fixing flows | spot FX | 128 month ends × 4 pairs, 2016 → 2026: **+0.01, +1.13, −1.00, −0.37 bps a trade** (t ≤ 0.82). The pre-fix hour does move more at month end (median 11.8–15.9 bps against 8.1–10.9), with no direction to fade | — | — | — | — | **dead** |
| — | PARITY: put-call parity / boxes on Deribit | conversions and reversals against the dated future | Deribit · taker fees | 475 BTC and 422 ETH strike pairs at 18:40 UTC: **best −12.45 / −14.39 bps after fees**, none positive | — | — | — | crypto derivatives are closed to UK retail (FCA PS20/10); Deribit is unfunded here | **dead** |
| — | VRP: selling BTC/ETH implied volatility | implied above realised | Deribit | DVOL against the next 30 days' realised, 2021-03 → 2026-09: BTC +8.39 vol points (72 % of days), but **−0.56 in 2026**; ETH +4.41, −2.76 in 2025, +0.37 in 2026; worst −46 / −108 points | — | daily | the tail | as PARITY | **dead now** (the premium has gone, the tail has not) |
| — | FUNDX: the funding spread, Hyperliquid against OKX | two perps on one coin | Hyperliquid + OKX · 19 bps a round trip, taker | 8 coins, 101 days: Hyperliquid pays **0.77–1.40 bps a day** more on every coin, steady; the 7-day switching rule nets −43 to +9 bps over the window | a static hold earns about 2.8–5.1 %/yr on notional | daily | price basis between venues; venue risk | perpetuals: FCA retail ban | **dead** (about cash, on two banned legs) |
| — | LEND: stablecoin lending against the bill | rate dispersion | DefiLlama's pools | US 3-month bill 4.05 %; USDC median base supply 4.21 % (27 pools ≥ $10 m), USDT 3.48 %; the outliers (10.3 % on a $16 m, 92 %-utilised pool) are a risk premium; sUSDe 4.84 %, sUSDS 3.80 % | — | — | smart contract, withdrawal queues | none for a wallet | **dead** (cash) |
| — | Index inclusion and rebalancing flows | buy before the effective date | — | not measured: no keyless announcement history; the S&P 500 inclusion effect is reported to have disappeared (Greenwood & Sammon, "The Disappearing Index Effect", 2022; not re-read here) | — | — | — | a long-only version only | not measured |
| — | Dividend capture, US and UK | the ex-date drop against the dividend | — | arithmetic: a UK resident's US dividend carries 15 % withholding (W-8BEN), a UK purchase 0.5 % stamp duty, and a typical quarterly yield is about 1 %: both lose before any price effect | — | — | — | — | dead (arithmetic) |
| — | UK investment-trust discounts; US closed-end funds | discount mean reversion | LSE · 0.5 % stamp duty on purchase, still due on listed trusts (the Autumn Budget 2025 relief covers only new listings) | not measured: no keyless NAV history | slow (months) | — | — | US CEFs carry no UK KID: not sold to UK retail | not measured; a slow value trade, not stat arb |
| — | CEX–DEX arbitrage on L2s; MEV backruns | price gaps between venues | Base / Arbitrum sequencers, builders | not measured: the arbitrage is taken within a block by searchers who pay the sequencer or builder for priority; a Worker's round trip loses that race | — | sub-second | — | none legal; out of reach on speed | dead (speed) |
| — | Oracle lag on perp DEXs; CME basis | stale prices or futures basis | perp DEXs, CME | not measured | — | sub-second / daily | — | derivatives: FCA retail ban | dead (access) |
| — | Maker-rebate tiers and liquidity programs | a subsidy | Kraken, Binance, Polymarket, Hyperliquid | the tiers this repo has read (Kraken at this account's 0.40 % maker, Polymarket P2/P3 in fp4) need volume a $10k account cannot reach; others not re-read | — | — | — | — | dead (volume) |
| — | Airdrop and points farming | a speculative subsidy | — | no measurable expected value (fp4 B18) | — | — | — | — | not a strategy |
| — | Sports models against the closing line | a forecast | — | VB's own baseline: Pinnacle's and the exchange's kick-off prices tie on log loss (0.9987 against 0.9988 on 10,642 matches), the same prices a model would have to beat | — | — | — | — | dead for an amateur model |

The first search's three, PR5-EUR, CJ5 and CBSWEEP, still stand as it ranked them. They are the venue-shaped ones this
repo can build fastest; VB-K and FXW-AUD are the different ones.

## 3. The measurements

### 3.1 VB: value betting on football-data.co.uk's odds (`vb_football.py` → `results/vb_football.json`)

**The data.** 132 season files, 22 divisions (England's five, Scotland's four, Germany, Italy, Spain and France two each,
the Netherlands, Belgium, Portugal, Turkey, Greece), 2021-22 → 2026-27. That is 40,163 settled matches, 1,385 of them
in 2026-27 so far.
- Each file carries Pinnacle, the Betfair Exchange and up to nine UK books. It holds two snapshots: "pre-closing",
  "collected Friday afternoons" for weekend games "and on Tuesday afternoons for midweek games" (football-data's
  notes), and "closing", at kick-off.
- **Pinnacle is missing from 2026-27**, so Pinnacle-anchored rules stop at 2025-26. The Betfair Exchange runs from
  2024-25 on.

**The baselines** (every outcome bet, a unit each):
- the best UK price: −5.92 % before the close, −5.52 % at it;
- Pinnacle's own price: −5.48 % / −4.90 %;
- the exchange at 2 % commission: −6.90 % / −2.61 %.
So no source is a free lunch, and the filter is what matters.

**Results** (power de-vig unless named; t is the mean over its standard error):

| rule | bets | ROI | t | closing-line value | by season |
|---|---:|---:|---:|---:|---|
| close, Pinnacle anchor, θ 2 % | 4,833 | +3.58 % | 1.58 | — | — |
| **close, Pinnacle anchor, θ 4 %** | **2,645** | **+6.88 %** | **2.20** | — | 21-22 +11.8, 22-23 +5.3, 23-24 +14.1, 24-25 +4.1, 25-26 −10.3 % |
| close, Pinnacle anchor, θ 4 %, **proportional** de-vig | 3,595 | +1.32 % | 0.37 | — | — |
| **close, exchange anchor, θ 2 %, odds < 5** | **1,133** | **+5.83 %** | **1.37** | — | 24-25 +4.6 (580), 25-26 +7.3 (499), 26-27 +5.2 % (54); +66.1 units, worst drawdown 32.4 |
| close, exchange anchor, θ 2 %, all odds | 1,248 | +4.17 % | 0.97 | — | — |
| pre-close, Pinnacle anchor, θ 2 % | 2,486 | +1.26 % | 0.37 | +2.44 % | odds < 5 (post hoc): 1,908 bets, +5.33 %, CLV +2.93 %; odds ≥ 5: −12.2 %, CLV +0.8 % |
| pre-close, Pinnacle anchor, θ 4 % | 1,053 | −1.86 % | −0.34 | +4.78 % | — |
| pre-close, exchange anchor, θ 2 % | 2,242 | −4.08 % | −1.18 | −3.98 % | the Friday exchange price is thin: a poor anchor |
| betting AT the exchange, Pinnacle anchor, 2 % commission, θ 2 % | 2,514 (pre) / 2,203 (close) | −7.33 % / −3.10 % | −1.19 / −0.68 | — | the exchange is as sharp as Pinnacle |

**Log loss** (matches carrying both anchors):
- before the close: Pinnacle 1.0017, the exchange 1.0086 (10,519 matches);
- at kick-off: Pinnacle 0.9987, the exchange 0.9988 (10,642 matches).
At kick-off the exchange is as good a fair price as Pinnacle. That matters because the exchange is still in the data,
and Smarkets serves its own exchange prices keylessly.

**What the table says.**
- **At kick-off, UK books that lag a sharp price pay**: +5.8 % to +6.9 % on the cleanest rules, on more than a thousand
  bets.
- **It is not proof.** The best t is 2.20. The sign depends on the de-vig method: power gives +6.88 %, proportional
  +1.32 %. Longshots (odds ≥ 5) lose in every arm, which is the favourite-longshot bias the margin hides. The odds < 5
  cut is post hoc on the Pinnacle arms and was carried into the exchange arm before it ran.
- **Before the close the edge shows as closing-line value** (+2.4 % to +5.4 % against Pinnacle's closing price) more than
  as profit, which the variance of a few thousand bets cannot resolve.
- **The closing rule needs the price minutes before kick-off.** football-data's "closing" snapshot is what a bettor could
  have had only with a live feed.
- **Capacity is the books' own decision.** Bookmakers routinely limit accounts that beat the closing line. This is the
  known ceiling of value betting, not measured here.

### 3.2 FXW and FIX: FX weekend gaps and the 4 pm fix (`pull_fxcm.py`, `fx_weekend_fix.py`, `fx_yahoo_check.py`)

**The data.** FXCM's public 1-minute bid/ask archive, 2016 → 2026, for EUR/USD, GBP/USD, USD/JPY and AUD/USD.
- 2,161 of 2,332 weekly files were served. The misses are week-53 slots, a few 2019–2025 weeks and 2026 weeks 18–31
  and 40 on (not yet published), all logged in `inputs/fx/fxcm_pull_log.json` with each file's sha256.
- The raw files (about 330 MB) are not committed. Two derived tables are: one row per weekend, one row per London weekday.
- A "weekend" is Friday's last minute and the next open 40–60 h later: 524–525 per pair.

**FXW** (fade a gap g of at least G):

| pair | Sunday-open spread (median) | G 20 bps, at the open with take-profit (E0) | at the open, no take-profit (E0b) | an hour later (E1) |
|---|---:|---|---|---|
| AUD/USD | 8.35 bps | **+21.84 bps, n 85, t 5.58**, hit 85 % | +20.00, t 3.04 | +8.09, t 1.11 |
| EUR/USD | 4.60 | +7.56, n 53, t 1.39 | +7.33, t 1.09 | −3.07, t −0.47 |
| GBP/USD | 8.33 | −6.46, n 72, t −1.02 | — | −20.48, t −2.57 |
| USD/JPY | 5.19 | −3.39, n 79, t −0.55 | — | −10.43, t −1.41 |

AUD/USD by year (E0, G 20 bps, total bps), 2016 → 2026: +207, +152, −19, +94, +336, +126, +194, +30, +104, +233, +398.

**FXW on a second feed** (Yahoo's hourly FX, whose week starts at Sunday 23:00 or Monday 00:00 UTC):
- On the 122–123 weekends both hold, Yahoo's gap correlates with FXCM's at only 0.24–0.46. A median 54–63 % of an
  FXCM gap of ≥ 20 bps is still open when Yahoo's week starts.
- Yahoo's own late fade: AUD **+20.8 bps (t 1.72, n 28)**, EUR +4.7, GBP +22.7 (t 2.02, n 17), JPY −7.1.

**Reading.**
- AUD/USD's reversion is consistent across years and shows on a second feed. GBP's is not consistent: it is negative on
  FXCM and positive on Yahoo.
- The gap itself is feed-specific, and the money is made at the open. A broker's opening quote decides whether any of
  it is real.
- Eight arms per pair were looked at (four thresholds × E0/E1), plus E0b and the Yahoo check after the first look. AUD's
  t 5.58 would survive a Bonferroni cut over 32 arms; whether it survives a different broker is unknown.

**FIX** (on each month's last London weekday, fade the 15:00 → 16:00 London move from 16:05 to 18:00, 1.5 bps a round
trip):
- 128 month ends per pair: EUR +0.01 bps a trade (t 0.01), GBP +1.13 (t 0.82), JPY −1.00, AUD −0.37.
- The other weekdays: −1.3 to −1.8 bps, which is about the cost, so nothing gross.
- The pre-fix hour moves more at month end (medians 11.8–15.9 bps against 8.1–10.9), but in no direction a rule can
  fade. **Dead.**

### 3.3 Equities: DCS, ADRX, PAIRS (`pull_yahoo.py`, `eq_dual_adr.py`, `eq_pairs.py`)

**DCS** (10 years of daily closes; switch at the next close when the class spread is 1 % beyond its 60-day mean):

| pair | spread sd (dev.) | half-life | %/yr, 20 bps a switch (all / last 2 y) | switches a year |
|---|---:|---:|---|---:|
| BF-B / BF-A | 2.96 % | 16.8 d | +2.04 / +1.63 | 4.5 |
| UAA / UA | 1.81 % | 9.6 d | +2.05 / −0.41 | 6.2 |
| Z / ZG | 1.01 % | 8.1 d | +1.20 / −0.50 | 4.0 |
| FOXA / FOX | 1.02 % | 12.3 d | +0.47 / +1.05 | 3.0 |
| GOOGL / GOOG | 0.43 % | 7.7 d | +0.25 / −0.48 | 0.4 |
| NWSA / NWS | 1.21 % | 10.1 d | +0.13 / +0.01 | 2.7 |
| LEN / LEN-B | 1.61 % | 14.5 d | −0.54 / −1.10 | 3.8 |
| HEI / HEI-A | 2.35 % | 14.5 d | −0.92 / +1.83 | 4.8 |
| MOG-A / MOG-B | — | — | **void**: MOG-B printed no trade on 64 % of its last 500 days, so its "+30 %/yr" is stale closes | — |

LBRDA/LBRDK: Yahoo served too little history. The eight valid pairs average +0.59 %/yr (last two years +0.26 %).

**ADRX** (59 days of 5-minute bars in the London/New York overlap, 12 ADRs with their ratios):
- The ADR premium sits at −0.43 % to +0.31 %. Its deviation from the previous 5 days' median has an sd of 8.6–32.1 bps;
  LYG's 32 bps is the ADR's 1-cent tick on a $4.8 price.
- About 2 % of bars on most names are beyond 65 bps. Each is a whole day shifted: 2026-08-13 for six names, 08-06 for
  three. These are ex-dividend dates that differ between the lines, not gaps a switch can take.
- On days not shifted whole, bars beyond the 80 bps a GBP account's round trip costs: 0–3 per name in 59 days. **Dead.**

**PAIRS**:
- 98 names were chosen by sector before any price was read. HES and K were acquired in 2025, and AVB and EQR have no
  Yahoo history under these tickers before 2026, so 94 names traded.
- 21 overlapping six-month trading periods from 2016, 467 round trips.
- Gross −0.69 %/yr (sd 1.19 %); −1.29 % with broker borrow; −3.10 % as CFDs. Positive years: 2020, 2021, 2026.
- Survivorship makes even this an upper bound. **Dead**, as the literature's decay of the method says it should be.

### 3.4 Crypto and DeFi: PARITY, VRP, FUNDX, LEND, LRT

**PARITY** (`results/deribit_parity_2026-10-09T1840Z.json`): every strike with a call, a put and a dated future.
- Conversion: buy the call, sell the put, sell K USD of the inverse future; it locks 1 − K/F BTC. The reversal is the
  mirror. Taker fees are 0.03 % of the underlying per option leg (capped at 12.5 % of its price), 0.05 % on the future,
  and the 0.015 % delivery fee.
- BTC: 475 pairs, best −12.45 bps, median −33.3. ETH: 422 pairs, best −14.39, median −41.0. Market makers hold parity
  inside the fees. Boxes, being two conversions, are worse.

**VRP** (`results/vrp.json`): DVOL's daily close against the next 30 days' realised volatility from Binance's daily
closes, 1,996 days per coin.
- BTC: mean +8.39 vol points, IV above RV on 72 % of days, worst −46.1. By year: +17.9, +12.3, +6.5, +7.0, +6.6, then
  **−0.56 in 2026**.
- ETH: +4.41, worst −108.4; 2025 −2.76, 2026 +0.37.

**FUNDX** (`results/funding_xvenue.json`): 2026-06-30 → 10-08.
- Hyperliquid's daily funding exceeds OKX's on all eight coins: BTC 0.91, ETH 1.40, SOL 1.10, XRP 1.12, DOGE 0.98, AVAX
  0.77, LINK 1.26, SUI 1.36 bps a day.
- The 7-day switching rule nets −43.4 to +9.0 bps over the window.
- A static short Hyperliquid / long OKX earns about 2.8–5.1 %/yr on notional before costs. That is cash, on two
  perpetuals a UK retail account may not hold.

**LEND** (`results/defi_lending_2026-10-09.json`) is in §2's table. **LRT** (`results/lrt_discount_2026-10-09T1846Z.json`)
is the stETH test of the first search repeated on four tokens. Only rETH's 31 bps is beyond gas and rounding, and
Rocket Pool redeems at the rate only while its deposit pool holds ETH, which was not read.

## 4. The top three, as draft paper tests

Each follows `TEMPLATE-variant-prereg.md`'s sections. None is frozen, and none is a twin row: each needs its own design
pass and Davies' word. Nothing here changes PR5, its twins, RW or the trend rows.

### 4.1 Draft: VB-K, value bets at UK bookmakers against the exchange at kick-off

**0. On whose word.** Davies' request of 2026-10-09 (quoted at the top). Stage 1 needs no account and no build. Stage 2
needs his sign-up for an odds-feed key. Betting itself would be his, by hand.

**1. What it is.**

| | |
|---|---|
| fair | the Betfair Exchange's closing back prices, de-vigged by the power method |
| bet | the best price among the nine UK books named in §3.1, when price × fair − 1 ≥ 2 % and the price is under 5.0; one unit on each qualifying outcome |
| markets | 1X2, the 22 divisions of §3.1 |
| settle | the full-time result |

**2. Why.** +5.83 % on 1,133 bets (t 1.37), positive in each of the three seasons the exchange anchor covers. The
Pinnacle-anchored θ 4 % version gave +6.88 % on 2,645 bets (t 2.20).

**3. Window, reading and bar.**
- **Stage 1 (forward, no build):** the same rule, unchanged (`vb_football.py`'s `1x2.close.soft_vs_exch_odds_lt5.th2`
  arm, power de-vig), on 2026-27 matches played after the freeze, read from football-data's file on or after
  2027-06-01. That is about 250 bets (54 came from 2026-27's first 1,385 matches; 2025-26 gave 499), so a standard error
  of about 9 points.
  - Bar: ROI > 0 and the 2026-27 out-of-sample bets' ROI above −1 SE of the in-sample +5.83 %. Read honestly: the
    stage can refute but cannot prove.
- **Stage 2 (on his word):** a recorder, one Edge call a minute in the last 30 minutes before each kick-off, reading
  Smarkets' exchange prices (keyless, the first search's client) and the UK books' prices from an odds API (key
  needed). It joins `edge_calls` and the watchdog.
  - It measures what the historical test cannot: whether football-data's "closing" UK prices were there to take five
    minutes before kick-off, and the closing-line value of bets placed then.
  - Bar: mean CLV against the exchange's kick-off fair ≥ +2 % on at least 300 bets.
- **Health:** the file re-pull's row count grows; no arm's column vanishes, as Pinnacle's did.

**4. Its record before now.** §3.1, in sample: the anchor, the de-vig method and the odds < 5 cut were all chosen with
the results in view.

**5. Frozen files.** `vb_football.py` and the 2026-27 file as pulled at the freeze (its sha256).

**6. Disclosures.** Every figure in §3.1 was seen. The odds < 5 cut is post hoc.

### 4.2 Draft: FXW-AUD, fade AUD/USD's Sunday-open gap

**0. On whose word.** As 4.1. The decisive check needs a broker's demo account: no money, but Davies' sign-up and a
demo key he stores himself.

**1. What it is.** At the first quote after the weekend, when |ln(open mid / Friday's last mid)| ≥ 20 bps, trade against
the gap at the broker's own bid/ask. Close when the mid touches Friday's close, else at +24 h.

**2. Why.** §3.2: +21.84 bps a trade on 85 weekends (t 5.58), 10 of 11 years positive, on FXCM's 2016–2026 bid/ask.
Late entry on Yahoo's feed gives +20.8 (t 1.72).

**3. Window, reading and bar.**
- **Stage 1 (record, on his word):** each Sunday from 20:55 to 23:00 UTC, a 1-second pg_cron reader stores the demo
  broker's AUD/USD bid/ask, FXCM's archive for the same minutes once published, and Friday's last quotes.
  - It is a recorder, not a trader. After 12 weekends it reads three things: the broker's first tradable quote, its
    spread, and its gap against FXCM's.
  - Bar to continue: on the weekends where FXCM's gap is ≥ 20 bps, the broker's gap is ≥ 70 % of it, at a spread ≤ 12 bps.
- **Stage 2 (paper):** the rule on the broker's own quotes. At about 8 trades a year, a 40-trade bar takes five years,
  so the honest plan is a historical replication on the broker's own history if it serves one; else this stays
  descriptive.

**4. Its record before now.** §3.2, in sample.

**5. Frozen files.** `fx_weekend_fix.py`, `inputs/fx/fxcm_AUDUSD_weekends.csv.gz`, and the recorder's migration (none
written yet).

**6. Disclosures.** Every §3.2 figure was seen. E0b and the Yahoo check were added after the first run.

### 4.3 Draft: DCS, the cheaper class of a company already held (paper, daily)

**0. On whose word.** As 4.1. Useful only for a company Davies holds or wants. Nothing is built for him to trade.

**1. What it is.** §3.3's rule: a 60-day mean, a 1 % band, execution at the next close, 20 bps a switch, on the eight
valid pairs. The page shows the excess over the static 50/50 mix.

**2. Why.** +0.59 %/yr on average, BF-B/BF-A +2.04 %: small, steady and nearly free to run.

**3. Window, reading and bar.** Twelve months forward from the freeze, read on its anniversary. Bar: the eight pairs'
mean excess > 0 net of 20 bps a switch, and a sign test across pairs at p < 0.1. Health: each day's closes read.

**4. Its record before now.** §3.3, in sample (the band and lookback were fixed before the run; the ten pairs were
listed before any price was read).

**5. Frozen files.** `eq_dual_adr.py` and its daily inputs.

**6. Disclosures.** §3.3 was seen, MOG void included.

## 5. What each would need from Davies

- **VB-K.**
  - Stage 1: one word. It re-runs a committed script on a public file next June; nothing is deployed.
  - Stage 2: a free odds-API key he makes and stores, and his word for a recorder.
  - Betting for money would be his own accounts, placed by hand. UK bookmakers' terms generally forbid automation, and
    they limit accounts that win: plan on the edge lasting weeks to months at each book.
- **FXW-AUD.** A demo account at a UK spread-bet broker with an API (no money), a demo key he stores himself, and his
  word for a Sunday recorder. Nothing trades before its first stage reads clean.
- **DCS.** Only interest: it pays on a holding he already has.
- **Standing rules kept.**
  - Never trade by hand in the loop's Revolut X account or PR5's sub-account (key `_2`).
  - Polymarket opens a position only from Ireland under his attestation.
  - Nothing here asks for a VPN, a proxy or anyone else's account.

## 6. What was not done or not checked

- **Betfair's commission and API terms.** Its commission (2 % and 5 % were scored) and its live-key terms were not
  verified at source: a search found only a third-party aggregator.
- **Soft-book prices at kick-off.** Whether football-data's "closing" UK prices were available minutes before kick-off
  is unverified (Stage 2 measures it).
- **Account limits.** Bookmakers' limits on winning accounts were not measured.
- **Second FX source.** Dukascopy's tick archive reset every connection from this machine, so FXW's second source is
  Yahoo, which starts 1–2 h after the open. No retail broker's Sunday quotes were read.
- **FXCM's 2026 weeks.** FXCM's archive misses 2026 weeks 18–31 (and 40 on, not yet published); FXW's 2026 has 24
  weekends.
- **Trading 212's listings.** Whether T212 lists each dual class, or rests a limit order on the exchange, is unverified.
- **The LRT and LEND snapshots** are one read each; Rocket Pool's deposit pool was not read.
- **OKX's short history.** OKX serves about three months of funding; nothing longer was found keylessly.
- **Not measured, for want of keyless data:** index-inclusion events, UK trust NAVs, US closed-end funds, CEX–DEX and MEV
  races, and maker-rebate tiers (§2).
- **No production table was read.** Nothing was placed, cancelled, funded or signed up for.

## Files

- `docs/agents/backtests/statarb_search2/`: scripts, inputs, results, and `MANIFEST.json` (sha256 of every file).
