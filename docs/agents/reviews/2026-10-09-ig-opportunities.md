# IG: what its API can do, and which edges survive its costs (2026-10-09)

Davies, 2026-10-09: "ig的账户我也注册了正在审核资料中，目前还拿不到api，ig的api可以做所有cfd trading吗？似乎还有option trading，还有个叫spread betting，可以深度研究下有什么机会".
He has applied for an IG account (under review, no API key yet). IG came up for FXW-AUD, the AUD/USD Sunday-gap fade of
STATARB-2 (`reviews/2026-10-09-stat-arb-search-2.md` §3.2, §4.2).

**What this is.** Research only, on IG's public pages and keyless market data. No account was opened, no key was made or
read, nothing was traded, no production table was read. No pre-registration was frozen: the one in §C.2 is a draft.

**Sources.** IG's own words come from labs.ig.com and IG's UK help centre, read on 2026-10-09 (the product-detail pages
are dated 2026-09-08). The tax and rule pages come from HMRC, legislation.gov.uk and the FCA. The text of every page quoted
is committed under `backtests/ig_research/inputs/ig_pages/`, with each raw page's sha256 in `index.json`. Every figure in
Part B comes from `docs/agents/backtests/ig_research/`: its scripts, the inputs they read and its results, each file
with its sha256 in `MANIFEST.json`. The five scorers gave the same bytes on two runs.

## Plain answers

- **Can IG's API do all CFD trading?** Nearly. IG's FAQ says: "Our API supports OTC trading in any market instrument
  available to your account via our dealing platform". That covers spread bets and CFDs on FX, indices, commodities,
  bonds, rates and sectors, plus IG's own options. Shares can be traded but not priced: "Shares trading is available but
  without share price information", and "Subscription to equity prices is not available".
- **What the API cannot reach.** Share dealing, the ISA and the SIPP (the API refuses any product code but `IGCFD`,
  `IGFSB` and `IFFUTOPT`). It also has no DMA ("Direct market access is not currently available for our APIs"). IG's
  "QUOTE" order type needs a separate agreement.
- **Options: yes.** IG's options are its own OTC contracts (`OPT_INDICES`, `OPT_CURRENCIES`, `OPT_COMMODITIES`,
  `OPT_RATES`, `OPT_SHARES`), traded through the same API. As a spread bet they are untaxed for a UK resident.
- **Spread betting vs CFD.** They are two separate accounts under one login. A spread bet is in £ a point; a CFD is in
  contracts. A spread-bet gain is not a chargeable gain (HMRC CG56105) and pays no stamp duty, and a spread-bet loss
  cannot be offset. A CFD pays CGT and its losses are allowable (CG56100). The API switches between the two accounts
  (`PUT /session`).
- **Opportunities.** One is worth a paper test: **FXW-AUD**. It keeps its edge unless IG's opening spread is wider than
  about 50 bps (§B.1), but IG's weekday FX opens an hour before the feed the edge was measured on. The second test is a
  **backfill of IG's own weekend markets**, which no public data covers (§B.2).
  - Everything else measured here is either beta or decayed, or it fails IG's minimum stakes:
    - the index calendar effects;
    - option selling (the variance premium);
    - short VIX futures;
    - FX carry.
  - **Nothing in Part B clears a multiple-testing bar except FXW-AUD**, and that one rests on a single feed.

## The ranked table

Sizing: notional = L × account, where L is the smaller of IG's retail leverage cap and the level at which the worst
drawdown seen costs 20 % of the account (`scripts/summary.py`). £ a year is untaxed for a spread bet.

| # | candidate | mechanism | measured, net of IG's costs | trades a year | £ a year at £1k / £5k / £20k | worst drawdown (notional; at L) | confidence | IG terms | verdict |
|---|---|---|---|---:|---|---|---|---|---|
| 1 | **FXW-AUD at IG** | fade AUD/USD's Sunday-open gap of 20 bps or more; take profit at Friday's mid, else close at +24 h | +18.9 bps a trade at an assumed 12 bps IG opening spread, t 4.82, n 85 (FXCM, 2016–2026). Breakeven spread about 50 bps | 7.9 | £179 / £897 / £3,588 (L 12) | −1.7 %; −20 % | **medium-low**: one feed, and IG opens an hour before it | out-of-hours quotes are IG's "own view"; Term 5(8) voids | **paper test 1** (§C.2): IG's own hourly history first, then a Sunday recorder |
| 2 | **WKND: IG weekend markets against the Sunday reopen** | IG prices Weekend Wall Street, US Tech 100, UK 100 and Germany 40 from "client activity and news flow" with nothing to arbitrage it | not measurable without IG's data. The window it prices (ES, Friday close → Sunday open, 109 weekends) moves a median 14.3 bps, p90 72.5; IG's weekend spreads are 5.2–7.7 bps | about 50 | — | — | none yet | the same; weekend positions roll into weekday ones at 22:40 | **test 2**: backfill 360 days of IG's hourly weekend prices (about 8,600 of the 10,000 weekly points), descriptive |
| 3 | ESG: fade the S&P futures' weekend gap on the US 500 DFB | the gap partly reverts by Monday's close | G 0.5 %, exit Monday 16:00 ET: +50.2 bps, t 1.57, n 18 (730 days of hourly ES) | 8.6 | (£408 / £2,041 / £8,164 by the rule; not to be trusted on 18 trades) | −2.1 % | low (n 18) | none special | descriptive; folds into test 2's recording |
| 4 | Pre-holiday long, US 500 | the pre-holiday drift (Ariel 1990) | 2011–2026: +8.9 bps, t 1.38, n 148 (all 1995–2026: +7.9, t 1.39) | 9.4 | £22 / £109 / £437 (L 2.6); does not fit the £1 minimum stake at £1k | −7.7 % | low | none | not worth a row |
| 5 | FOMC day long, US 500 | the pre-FOMC drift (Lucca and Moench 2015) | 1994–2011: +32.6 bps, t 3.06; **2012–2026: +8.2, t 0.84; last 5 years +2.7, t 0.13** | 7.9 | £14 / £70 / £281 | −9.9 % | low: decayed after publication | none | dead |
| 6 | Overnight long (close → open) | the overnight premium | gross 3.4–4.8 bps a night (2011 on), but IG's DFB funding is **2.0 bps a night** at today's SOFR + 3.4 %; net US 500 +0.9 (t 0.81), US Tech 100 +2.4 (t 1.88), last 5 years ≈ 0 | 251 | US Tech 100: £31 / £156 / £623 (L 0.5); does not fit the minimum stake below £60k | −39 % | low: this is beta | none | dead as an edge (§B.3) |
| 7 | PUT-write: sell a monthly at-the-money US 500 put | the variance risk premium | CBOE PUT 2011–2026: **8.2 % a year, Sharpe 0.55, worst −28.9 %**, against the S&P 500 with dividends at 14.1 %, Sharpe 0.69, worst −33.4 %; IG's spread costs 0.06–0.16 % a year | 12 | £56 / £279 / £1,115 (L 0.69); **the £10-a-point minimum is £77,654 of notional** | −28.9 % | high that it is beta | none | not an edge; does not fit |
| 8 | Short VIX futures with a guaranteed stop at +30 % | the futures roll | 2013-05 → 2026-10: +22.8 % a year of notional, Sharpe 0.33, worst cumulative drawdown −150 % of notional | 12 rolls | £30 / £151 / £606 (L 0.13) | −150 % | medium | none | dead (the tail costs more than the roll pays) |
| — | Opening-gap fade, intraday | gaps revert by the close | US 500 −0.7 to −4.6 bps; Germany 40 −4.8 to −8.4 (gaps CONTINUED before 2011); UK 100 on ISF.L +12.4 at G 1 % (t 1.55; last 5 years +31.9, t 2.97, n 64, below the bar and possibly the ETF's own opening print) | — | — | — | — | — | dead |
| — | Day of the week | — | best of 20 arms 2011–2026: US Tech 100 Tuesday +9.7 bps, t 2.27; none clears 3.4 | — | — | — | — | — | dead |
| — | Daily / weekly straddle sales (IG's daily and weekly US 500 options) | the variance premium at short dates | the sign depends on the unmeasured ratio of at-the-money vol to VIX1D / VIX9D: weekly +25.1 bps at k 1.0 (t 5.23), +6.6 at k 0.9 (t 1.39), −11.8 at k 0.8; CBOE's real-price weekly put write made 4.8 % a year, Sharpe 0.26 | 49–251 | — | — | low | none | unproven; a demo read of IG's option prices settles k |
| — | Iron condors at IG | defined-risk premium | CBOE CNDR made 1.4 % a year, Sharpe −0.04 (2006–2026); IG's four spreads cost an estimated **6–16 % a year of its collateral** | — | — | — | high | — | dead |
| — | FX carry | rate differentials | IG charges tom-next ± 1.5 % a year each way; GBP/USD's gap is 0.14 % (SONIA 3.73 %, SOFR 3.87 %), EUR/USD's 1.37 % (ECB deposit 2.50 %): both below the fee | — | — | — | high | — | dead (arithmetic) |
| — | Turn of the month, month-end | — | closed by EQ1, EQ2 and DFC (reference §3.44), US and international | — | — | — | — | — | not repeated |

## Part A — the platform

### A.1 The API (labs.ig.com)

- **Two APIs.** REST (JSON over HTTPS) for accounts, dealing, markets, prices, history and watchlists. Lightstreamer
  streaming for prices, trade confirmations and account updates.
  - Base URLs: `https://demo-api.ig.com/gateway/deal` and `https://api.ig.com/gateway/deal` (FAQ).
- **Login.** `POST /session` v2 returns two headers, `CST` and `X-SECURITY-TOKEN`.
  - Both tokens are "initially valid for 6 hours but get extended up to a maximum of 72 hours while they are in use"
    (REST guide). The FAQ says 12-hour intervals between calls.
  - Weekend maintenance invalidates every token: "it is recommended that you implement your software solution to handle
    API calls being rejected as a result of your token being invalidated".
  - v3 returns OAuth tokens of about 60 seconds. The streaming API does not take OAuth tokens.
- **Which accounts.** "Any other account other than product code IGCFD, IGFSB and IFFUTOPT are not supported for Public
  API users". That means CFD, spread bet, and IG's US futures and options account. `accountType` is `CFD`, `SPREADBET` or
  `PHYSICAL`. "Stockbroking not supported for Public API users".
- **Products.** The market model's instrument types are:
  - `CURRENCIES`, `INDICES`, `SHARES`, `COMMODITIES`, `RATES`, `SECTORS`;
  - `OPT_COMMODITIES`, `OPT_CURRENCIES`, `OPT_INDICES`, `OPT_RATES`, `OPT_SHARES`;
  - `KNOCKOUTS_COMMODITIES`, `KNOCKOUTS_CURRENCIES`, `KNOCKOUTS_INDICES`, `KNOCKOUTS_SHARES`;
  - `BUNGEE_*`, `BINARY`, `SPRINT_MARKET`.
  - That an enum lists a type does not mean a UK retail account is offered it:
    - binary options have been banned for UK retail since 2019 (from memory; the FCA page was not re-read);
    - whether knock-outs and the weekend markets are on his account, and reachable by the API, is for the demo's
      `GET /markets?searchTerm=` to show.
  - Markets are tradable while `marketStatus` is `TRADEABLE`. The other states are `EDITS_ONLY`, `CLOSINGS_ONLY`,
    `ON_AUCTION`, `SUSPENDED` and so on.
- **Order types** (API order types page; positions and working-orders references):
  - **Immediate orders**, `POST /positions/otc`:
    - `MARKET` takes no level.
    - `LIMIT` is a "limit fill or kill" with a level, `timeInForce` `FILL_OR_KILL` or `EXECUTE_AND_ELIMINATE`.
    - `QUOTE` "is only available subject to agreement with IG".
    - Each can carry a stop and a limit (level or distance), and `guaranteedStop`.
    - It can carry a trailing stop (`trailingStop` with a `stopDistance` and a `trailingStopIncrement`; "If
      trailingStop equals true, then guaranteedStop must be false").
    - It also carries `forceOpen`, `currencyCode` and `expiry`. `expiry` is "DFB" for a daily funded bet, or a month
      for a futures bet.
    - A `dealReference` of up to 30 characters is ours to set, and `GET /confirms/{dealReference}` reads the result.
  - **Working orders**, `POST /working-orders/otc`: `LIMIT` or `STOP`, `GOOD_TILL_CANCELLED` or `GOOD_TILL_DATE`, with
    a stop, a limit and a guaranteed stop.
  - Closing is `DELETE /positions/otc`, or a POST with the header `_method: DELETE` for clients that cannot send a body
    with DELETE.
  - IG's FAQ sums it up: "We offer fill-or-kill/immediate-or-cancel market and limit orders".
- **Also there:**
  - client sentiment;
  - price history (`/prices/{epic}` v3);
  - activity and transaction history;
  - `GET /repeat-dealing-window`;
  - indicative costs and charges (`/indicativecostsandcharges/open`, which returns a cost quote before a deal).
- **Limits** (FAQ, "default REST Trading API limits"):
  - per app, non-trading requests: 60 a minute;
  - per account, trading requests: 100 a minute ("create/amend position or working order requests");
  - per account, non-trading requests: 30 a minute;
  - historical price data: 10,000 points a week;
  - streaming: 40 concurrent subscriptions.
  - "Unfortunately, at the moment there is no possibility to increase the limits". "Please do not create multiple
    concurrent connections as this may lead to your API key being suspended".
  - Using the API is free at the default quotas.
- **History depth** (FAQ):
  - 1-second bars: 4 days;
  - 1-, 2- and 3-minute bars: 40 days;
  - 5-minute to 4-hour bars: 360 days;
  - daily bars: 15 years ("up to 20 years").
  - Every `/prices` reply reports `remainingAllowance` and `allowanceExpiry`.
- **The key** (Getting started):
  - "At the moment we are limiting the number of API keys to one per account".
  - Live key: "Log into our web-based platform using your live account details; Go to My Account > Settings > API Keys".
  - Demo key: "Login to the web trading platform with your live account; Use the account switcher … to create a demo
    account"; then switch to demo and generate the key in the same place.
  - That is why a demo-only login showed no API Keys item. The FAQ: "You will need to apply for another demo account,
    and ensure that the email address you use on the application is the same as your live account".
  - **No approval beyond the live account is mentioned.** But see Term 9(12) in A.4.
- **Demo against live.** IG documents only the separate base URLs and keys. How demo fills compare with live ones is not
  documented, so treat demo fills as indicative.

### A.2 UK retail rules and IG's costs

- **The FCA's rules** (press release confirming PS19/18; in force since 1 August 2019 for CFDs and 1 September 2019 for
  CFD-like options):
  - "Limit leverage to between 30:1 and 2:1";
  - "Close out a customer's position when their funds fall to 50% of the margin needed";
  - "Provide protections that guarantee a client cannot lose more than the total funds in their CFD account";
  - a standardised risk warning (IG's: "70% of retail investor accounts lose money").
  - The tiers come from the ESMA measures and were not re-read at the FCA: 30:1 on major FX, 20:1 on non-major FX, gold
    and major indices, 10:1 on other commodities and indices, 5:1 on shares.
  - IG's own pages show the result: FX majors 3.33 % margin (30:1), AUD/USD 5 % (20:1), FTSE 100 / US 500 / Germany 40
    5 %, the weekend indices 5 %, VIX 20 %.
  - **Crypto derivatives are banned for UK retail** ("banning the sale … of any derivatives (ie contract for difference
    – CFDs, options and futures) … that reference unregulated transferable cryptoassets", from 6 January 2021).
- **Spreads** (IG product details, spread bets, 2026-09-08; bps at the 2026-10-08 close):

| market | in cash hours | out of hours | minimum stake | guaranteed-stop premium |
|---|---|---|---|---|
| US 500 DFB | 0.4 pt (0.52 bps), 14:30–21:00 UK | 0.6 pt; 1.5 at 22:00–23:00 | £1 a point | 0.25 pt |
| FTSE 100 DFB | 1 pt (0.96 bps), 08:00–16:30 | 2 to 21:00; 4 at 21:00–01:00; 3 at 01:00–07:00 | £0.50 | 0.8 |
| Germany 40 DFB | 1.2 pt (0.48 bps), 08:00–16:30 | 2; 5 at 21:00–00:15; 4 at 00:15–07:00 | £0.50 | 1.5 |
| US Tech 100 DFB | 1 pt (0.33 bps) | 2; 5 at 22:00–23:00 | £1 | 1 |
| Wall Street DFB | 2.4 pt in hours | 3.6 to 9.8 | £0.20 | 1.8 |
| US 500 futures bet | 1 pt; 2.4 at 22:00–23:00 | — | £1 | 0.4 |
| EUR/USD · GBP/USD · AUD/USD | minimum 0.6 / 0.9 / 0.6 pip; average 0.85 / 1.4 / 0.82 (12 weeks to 2021-01-08, Mon 00:00–Fri 22:00 GMT) | — | £0.50 / £1 / £0.50 a pip | 1.2 / 2 / 1.5 |
| Weekend UK 100 · Germany 40 · Wall Street · US Tech 100 | 8 / 14 / 20 / 16 pt (7.7 / 5.6 / — / 5.2 bps) | Sat 08:00 – Sun 22:40 UK | £2 / £2 / £1 / £2 | n/a |
| Weekend GBP/USD · EUR/USD · USD/JPY | 6 / 6 / 4 pips | Sat 08:00 – Sun 20:40 | £0.50 | n/a |
| Spot gold · Brent · natural gas | 0.3 / 2.8 / 3 pt minimum (charges page) | — | — | — |
| Options, daily US 500 · weekly / monthly US 500 · daily FTSE 100 · monthly FTSE 100 | 0.4–1.0 · 0.8–2 · 1–4 · 4–8 pt, "all-in" | — | **£10 · £10 · £2 · £2 a point** | — |
| VIX futures bet | 0.1 (undated 0.08); margin 20 % | — | "£100" as listed (whether a point is 1.00 or 0.01 VIX was not resolved) | 0.2 |

- **Overnight funding** (help centre).
  - **Index DFBs: "Bet size x price × (3.4% admin fee +/- SONIA%) ÷ 365"** for GBP markets, 360 for others, against SOFR
    for US indices. That is the spread-bet fee; the CFD fee is 3 %. It is charged on positions held through 22:00 UK, and
    three times on Fridays.
    - Long pays the benchmark plus 3.4 %. Short receives the benchmark minus 3.4 %, so it pays when the benchmark is
      below 3.4 %.
    - Today that is **2.02 bps a night** long on the US 500 (SOFR 3.87 % + 3.4 %), 1.95 on the FTSE 100 and 1.64 on the
      Germany 40.
    - Index DFBs are credited (long) or debited (short) the index's dividends, at Bloomberg's estimate.
  - **FX: "the tom-next rate plus an admin fee of 1.5%"**, three days on Wednesdays. The FX page's older note says
    0.0022 % a day.
  - **Futures bets pay no funding** ("Futures and forwards don't incur overnight funding charges, but they do have wider
    spreads"). Their carry is in the price.
- **Other costs** (charges page):
  - Guaranteed stops: "Premiums are only charged if your stop is triggered".
  - Currency conversion: 0.8 % on a trade "in a currency different from your account base currency". A £-a-point
    spread bet settles in £.
  - **No inactivity fee** (shown as "Free").

### A.3 Tax

- **Spread bets.** TCGA 1992 s.51(1): "winnings from betting … are not chargeable gains". HMRC's CG56105 says of
  financial spread betting: "no chargeable gains or allowable losses arise from spread betting". IG's agreement: "UK tax
  law currently exempts UK residents from paying capital gains tax on winnings from betting".
  - The exception is BIM22020. Spread-bet wins are taxable when they "arise from the carrying on of that trade". That is
    a high bar for a person, but an automated, systematic book is the case to keep in mind.
  - No stamp duty applies.
- **CFDs.** HMRC's CG56100: "Retail contracts for differences are financial futures, and, unless the profits are taxable
  as trading income, in almost every case TCGA92/S143 charges the outcomes under the capital gains regime". So gains pay
  CGT, losses are allowable, and funding and dividends enter the computation. No stamp duty applies.
- **Ireland.** Davies is resident in both countries. The exemption is UK law, and IG says "Spread betting is only
  available from our UK entities". If he is Irish tax resident, Irish tax on the winnings needs an adviser's answer.
  That was not checked here.

### A.4 IG's terms that bind what is tradable (spread-betting customer agreement, July 2023)

- **Term 9(12):** "You will not use any automated software, algorithm or betting strategy other than those that we make
  available to you on our Electronic Betting Services without our prior written consent".
  - Term 9(6): "Use of any high speed or automated mass data entry system … will only be permitted with our prior written
    consent".
  - Term 9(8): a customised interface (FIX, REST) "shall be subject to our prior written consent".
  - **Generating an API key is probably that consent for the API itself.** Before anything automated deals live, Davies
    should still have IG's written confirmation (WebAPI support) that this account may run it.
- **Term 20(k):** no "arbitrage practices (such as but not limited to latency abuse, price manipulation or time
  manipulation) that aims to manipulate or take unfair advantage of the way in which we construct, provide or convey
  our Bid or Offer Prices".
  - It adds: "using any device, software, algorithm, strategy or practice … whereby you are not subject to any downside
    market risk will be evidence that you are taking unfair advantage of us".
  - Every candidate here carries market risk. None races IG's price against a faster feed.
- **Term 11, Manifest Error:** IG may "void from the outset or amend the terms of any Bet containing or based on any
  error that we reasonably believe to be obvious".
  - Term 8(12) adds voids when a Term 5(8) factor was not met.
  - The product pages say that out of hours, and on weekend markets, "our quotations reflect our own view … business done
    by other clients may itself affect our quotations".
  - **A strategy that profits from IG's opening or weekend quote being wrong is exactly what IG can call an error.** This
    is the main terms risk for both tests in §C. A gap fade at a normal spread is not an error, but a bet placed at a
    price far from the market can be voided.

## Part B — the measurements

The rules are in each scorer's docstring, written before its first run. One change came after a first look: Yahoo's
`^FTSE` open equals the previous close on 93–100 % of days from 2001, so it is a stale field. UK 100 was moved to ISF.L,
which has its own opening auction and dividends (2009 on).

The arms are counted as follows:
- 46 in IDX;
- 4 in ESG;
- 18 straddle arms;
- 3 VIX arms;
- FXW-IG as one rule under seven costs.

That makes about 72, so a Bonferroni bar at 5 % is |t| ≥ 3.4. STATARB-2 found FXW-AUD among 32 arms.

### B.1 FXW-AUD at IG (`fxw_ig.py` → `results/fxw_ig.json`)

STATARB-2's committed weekend table was re-read without change. The test is its rule E0 at G 20 bps, with three changes:
the entry is FXCM's first mid plus half an assumed IG spread, IG's funding is charged, and the timing is described.

| assumed IG opening spread | net bps a trade | t | worst drawdown (bps of notional) |
|---|---:|---:|---:|
| FXCM's own first minute (median 8.35) | +20.84 | 5.32 | −167 |
| 12 bps | +18.88 | 4.82 | −167 |
| 20 bps | +14.88 | 3.80 | −175 |
| 30 bps | +9.88 | 2.52 | −185 |
| 40 bps | +4.89 | 1.25 | −230 |

- 85 trades over 524 weekends, 7.9 a year, sd 36 bps a trade. The gross reversion from FXCM's first mid is **+26.88 bps
  (t 6.87)**, so the breakeven opening spread is about 50 bps (the entry pays half of it, plus 2 bps).
- **It is not a first-minute race.** Of the 85 trades, the take-profit was hit within 1 minute in 1.2 %, within 60 minutes
  in 10.6 %, within 4 hours in 40.0 % and within 24 hours in 75.3 %. A minute loop is fast enough to enter.
  - The edge does need the open itself: entered an hour later it is +10.09 bps gross (t 1.39).
- **The timing problem.** FXCM's first minute is 22:00 UK in 449 of 524 weekends (17:00 New York). **IG's weekday FX opens
  at 21:00 UK** ("Normal dealing hours for all pairs are from 21.00 (London time) on Sunday").
  - So IG quotes an hour before the archive the edge was measured on, from whatever liquidity it has then.
  - IG's first price may already have moved some of the gap, or IG may quote it wide. Either way, only IG's own data
    can say.
  - IG has no weekend AUD/USD market. Its weekend FX is GBP/USD, EUR/USD and USD/JPY.
- **Funding** is trivial: tom-next plus 1.5 % a year, charged here as 1 bp a trade.
- **Size.** At £0.50 a pip the smallest bet is about £3,300 of notional. At L 12 the table's £179 / £897 / £3,588 a year
  at £1k / £5k / £20k costs a 20 % drawdown at the worst seen.

### B.2 IG's weekend markets, and the futures' own weekend gap (`es_sunday.py` → `results/es_sunday.json`)

- **What IG offers.** Weekend UK 100, Germany 40, Wall Street, US Tech 100 and Hong Kong HS50; weekend GBP/USD, EUR/USD
  and USD/JPY; weekend spot gold.
  - Hours: Saturday 08:00 to Sunday 22:40 UK (20:40 for FX).
  - "Positions open at 10.40pm (UK time) on a Sunday will roll over into weekday positions when those markets resume 20
    minutes later at 11pm".
  - IG prices them on "volatility, as well as client activity and news flow". "As the only provider of weekend trading,
    we do not have access to real-time data of underlying asset prices".
- **No public history of these prices exists.** The window they price is measurable: ES futures, Friday's last bar to
  Sunday's first, 109 weekends from 2024-05-19 to 2026-10-04.
  - **|gap| median 14.3 bps**, quartiles 6.5 / 34.9, p90 72.5, maximum 188.6.
  - IG's weekend spreads are 5.2 bps (US Tech 100), 5.6 (Germany 40) and 7.7 (UK 100). In 80–86 % of weekends the gap
    exceeds half the spread.
  - So a weekend price that is even modestly biased against the reopen is tradable. One that is the reopen's unbiased
    forecast is not.
- **The futures' own gap** reverts by Monday's close (slope of Monday's move on the gap −0.41), not by 10:00 ET (−0.02).
  - Fading |g| ≥ 0.5 % at Sunday's open, exiting at Monday 16:00 ET, makes +50.2 bps net (t 1.57, n 18, hit 72 %).
  - At ≥ 0.25 % it makes +12.5 (t 0.68, n 40). Exiting at 10:00 ET gives +2.0 to +10.0.
  - This is descriptive: 18 trades.
- **What the test needs.** IG's own weekend prices, through the API once the key exists (§C.2, test 2):
  - `/prices/{epic}` at HOUR for 360 days covers about 51 weekends;
  - four weekend markets × about 39 hours plus the weekday Sunday-night bars is about 8,600 points, inside one week's
    allowance of 10,000.

### B.3 Index calendar effects as DFBs (`idx_calendar.py` → `results/idx_calendar.json`)

The proxies are SPY (US 500, 1995 on), QQQ (US Tech 100, 1999 on), ISF.L (UK 100, 2009 on) and `^GDAXI` (Germany 40,
1999 on). Costs are IG's in-hours spread and funding at the benchmark of the day plus 3.4 %.

| arm (net bps a trade, t) | US 500 | US Tech 100 | UK 100 | Germany 40 |
|---|---|---|---|---|
| overnight long, gross / net, all | 3.88 / 0.95 (t 1.26) | 5.31 / 2.75 (t 2.56) | 4.02 / 1.19 (t 1.24) | 2.97 / 0.69 (t 0.90) |
| overnight net, 2011 on · last 5 y | 0.88 (t 0.81) · −0.51 | 2.40 (t 1.88) · 0.67 | 0.58 · −0.48 | 1.60 · −0.25 |
| intraday long, net, all | −0.10 | −1.39 | −2.06 | −1.30 |
| pre-holiday, net, all · 2011 on | 7.92 (t 1.39) · 8.87 (t 1.38) | 9.68 · 9.18 | 8.10 · 6.02 | 24.61 (t 2.38) · −0.10 |
| gap fade ≥ 0.5 %, net, all | −2.93 | 1.90 | 3.53 | −7.93 (t −2.54) |

- **FOMC days (US 500):**
  - Lucca and Moench's 1994–2011: +32.6 bps net, t 3.06, n 135.
  - 2012–2026: +8.2, t 0.84, n 116.
  - The last five years: +2.7, t 0.13.
  - The day before: +9.9 overall, t 1.22.
- **The overnight premium is real gross** (3–5 bps a night) and **almost all of it is IG's funding**: 2.0 bps a night at
  today's rates.
  - What is left is long beta over 17.5 hours a day, with a −35 to −39 % drawdown. It is not an edge.
  - A futures bet avoids the 3.4 % fee, but pays a 1-point spread and the futures' carry. It was not scored.
- **Day of the week.** No arm clears 3.4. The best is US Tech 100 on Tuesdays 2011 on, +9.7 bps, t 2.27.
- **Gap fades** lost on the US 500 and Germany 40. Germany 40's gaps continued before 2011 (−21.9 bps, t −2.82, for the
  fade). UK 100's positive fade is on ISF.L's opening print, which an index bet does not trade at.

### B.4 The variance risk premium (`vrp.py` → `results/vrp.json`)

- **It exists in variance.** Over 441 months, 1990-01 → 2026-09, the VIX beat the next 21 days' realised vol by **4.09
  vol points on average, in 83.9 % of months**.
  - The worst month was −60.6 (the 21 days from 2020-03-02).
  - 2011 on: 3.66 points, 83.1 %. The last 5 years: 3.41, 79.7 %.
  - 2018 averaged 0.15, 2022 1.05.
- **Monetised with real option prices, it is an equity-like return, not an arbitrage.** CBOE's benchmarks, 2006-02 →
  2026-10, return a year / Sharpe / worst drawdown:

| benchmark | 2006-02 → | 2011 → | last 5 y |
|---|---|---|---|
| PUT (monthly ATM put write) | 7.26 % / 0.43 / −37.1 % | 8.21 / 0.55 / −28.9 | 9.67 / 0.54 / −14.7 |
| WPUT (weekly) | 4.82 / 0.26 / −28.5 | 4.66 / 0.27 / −25.8 | 5.09 / 0.12 / −18.9 |
| BXM (buy-write) | 6.33 / 0.35 / −40.1 | 7.56 / 0.48 / −30.2 | 8.89 / 0.44 / −17.3 |
| CNDR (iron condor) | 1.40 / −0.04 / −19.5 | 0.71 / −0.12 / −19.3 | 3.57 / −0.03 / −9.8 |
| S&P 500 with dividends (SPY) | 11.10 / 0.48 / −54.8 | 14.14 / 0.69 / −33.4 | 13.82 / 0.56 / −23.8 |

- **IG's spread on top**, at half of IG's published option spread per option sold, held to expiry ("No spread is charged
  on automatic closings"):
  - PUT and BXM: 0.06–0.16 % a year;
  - WPUT: 0.27–0.67 %;
  - CNDR: an estimated **6.2–15.5 % a year of its collateral** (four legs; a wing of about 310 points). That kills condors.
- **IG's margin.** "The margin for 'selling' an option is the same as the margin incurred when trading the underlying
  futures market". The £10-a-point minimum on US 500 options puts one contract at £77,654 of notional.
- **Short-dated straddles.** IG's daily US 500 options settle at each day's close; its weekly ones are Friday to Friday.
  - Priced at k × VIX1D / VIX9D, both variance-swap rates that sit above at-the-money vol:
    - daily (1,104 days from 2022-05): +4.6 bps at k 1.0 (t 2.12), −3.2 at k 0.9, −11.0 at k 0.8;
    - weekly (769 weeks from 2011): +25.1 at k 1.0 (t 5.23), +6.6 at k 0.9 (t 1.39), −11.8 at k 0.8.
  - The worst week was −10.5 % of notional.
  - k is the unknown, and CBOE's real-price weekly put write says the premium at short dates is thin.
  - **A defined-risk structure** (short at-the-money, long wings) caps the tail, but its wings were not priced. The
    capped figures are upper bounds.
- **Short VIX futures** (the front contract, rolled five days before expiry, 2013-05 → 2026-10):
  - +33.7 % a year of notional, worst day **−149.5 %** (2018-02-05), Sharpe 0.34.
  - With a guaranteed stop at +30 %: +22.8 % a year, worst day −39 %, cumulative worst −150 % of notional, Sharpe 0.33.
  - Sized to a 20 % drawdown, that is about 3 % a year on the account.

### B.5 Other products, and what is clearly not worth it

- **Dividend adjustments on index DFBs.** IG credits longs and debits shorts "the ex-dividend figure estimated by
  Bloomberg". That is zero-sum by design. An edge would need IG's estimate to be biased, and IG publishes no history of
  its adjustments: not measurable.
- **Commodity roll.** IG's undated commodities and its VIX are "the method used to derive our undated commodity prices"
  with a 22:00 basis adjustment. Contango harvesting is the VIX case above, with the same tail. Oil was not scored.
- **FX carry.** Dead on IG's own fee, as in the table.
- **Shares.** These are 0.10 % commission each side, the API has no share prices, and US equities were closed by EQ1,
  EQ2 and DFC.
- **Already rejected in this repo and not repeated:**
  - crypto trend, momentum and rotation (crypto derivatives are banned for UK retail anyway);
  - pairs (STATARB-2);
  - the 4 pm fix;
  - Deribit parity;
  - crypto vol selling;
  - US PEAD and turn of the month.

## Part C — recommendation

### C.1 What to paper-test first, once the key exists

1. **FXW-AUD on IG's own prices** (§C.2). Its first stage costs one afternoon and no money:
   - IG's hourly AUD/USD history for 360 days (about 51 weekends, about 1,300 of the week's 10,000 points);
   - the first bar of each weekday week (21:00 UK) gives IG's opening bid/ask and its gap;
   - the same weekends' gaps on Yahoo's hourly feed are already committed (STATARB-2) for the comparison.
   - Then a Sunday recorder on the demo stream.
2. **WKND, IG's weekend markets against the reopen**, as a backfill: hourly weekend prices for 360 days, four markets,
   about 8,600 points. It is descriptive; a rule is frozen only if IG's last weekend price is biased against the Sunday
   23:00 reopen by more than the spreads.

Not recommended:
- option selling (no edge beyond beta, and the £10 minimum);
- the calendar effects (none passes, and most do not fit a £1k–£5k account at IG's minimum stake);
- short VIX (the tail).

### C.2 Draft pre-registration: FXW-AUD-IG (not frozen; from `reviews/TEMPLATE-variant-prereg.md`'s parts)

**0. On whose word.** Davies, 2026-10-09 (quoted at the top). Nothing runs before:
- his IG account is open and his demo key is stored by him as a Supabase secret;
- his word for the backfill and the recorder.

Nothing is traded with money under this draft.

**1. What it is.** STATARB-2's E0 at G 20 bps, on IG's AUD/USD spread-bet DFB quote (demo):
- the epic is found by `GET /markets?searchTerm=AUD/USD` and pinned in the migration;
- the gap is g = ln(IG's first tradable mid on Sunday / IG's last mid before Friday's 21:59 UK close);
- when |g| ≥ 20 bps, a paper position fades it at IG's first tradable bid or ask;
- it closes when IG's bid (for a long) or ask (for a short) reaches Friday's mid, else at +24 h at IG's bid or ask;
- funding is booked from IG's swap rate.

**2. Why.** §B.1: +18.9 bps a trade at a 12 bps spread (t 4.82, n 85, 2016–2026, FXCM). The breakeven spread is about
50 bps, and IG opens an hour before FXCM.

**3. Window, reading and bar.**
- **Stage 0 (backfill, the day the key works):**
  - IG's HOUR bars for AUD/USD over 360 days, with the read allowance logged.
  - Read: IG's 21:00 UK opening spread on each weekend; IG's gap against Yahoo's (Yahoo's week starts at 22:00–23:00
    UTC); and the rule on IG's hourly bars (the take-profit tested on bar highs and lows).
  - **Bar to continue:**
    - the median IG opening spread is ≤ 20 bps;
    - IG's gap correlates with Yahoo's at ≥ 0.5 over the weekends both hold;
    - on weekends with |g| ≥ 20 bps, IG's gap is ≥ 70 % of Yahoo's.
  - The rule's P&L on about 8 trades is reported, not barred.
- **Stage 1 (recorder, 12 weekends):**
  - A streaming recorder (C.3) stores IG's AUD/USD bid/offer every second from Sunday 20:55 to 23:00 UK and from Friday
    21:50 to 22:00.
  - Read after 12 weekends: when IG's first tradable quote comes, its spread over the first 60 minutes, and the minute
    the spread first falls under 12 bps.
  - **Bar:** IG's quote is tradable at ≤ 20 bps within 10 minutes of its open on ≥ 10 of 12 weekends.
- **Stage 2 (paper, the rule above):**
  - At about 8 trades a year, 40 trades take five years: Stage 2 is descriptive.
  - **Kill rule:** stop if the cumulative net after n trades is below −2 × 36 bps × √n.
  - A money stage needs Davies' word and a new pre-registration.
- **Until each reading, health only:** the recorder's beats, gaps in its stream, and login failures.

**4. Its record before now.** STATARB-2 §3.2 and this review §B.1, in sample.

**5. Frozen files (at freeze).**
- `../statarb_search2/scripts/fx_weekend_fix.py`;
- `../statarb_search2/inputs/fx/fxcm_AUDUSD_weekends.csv.gz`;
- `backtests/ig_research/scripts/fxw_ig.py`;
- the backfill script, the recorder's migration and its code, as written.

**6. Disclosures.** Every §B.1 and STATARB-2 §3.2 figure was seen. The 12 bps assumed spread and the 20 bps bar were set
after seeing the breakeven.

### C.3 A minimal IG client for this repo

- **Where it lives.**
  - `supabase/functions/_shared/ig.ts` holds the client: login, the rate governor and typed GETs. Every POST is behind a
    config row, as `polymarket_orders.ts` is.
  - The agents function hosts its actions, each a row of `public.edge_calls`:
    - `?action=ig-backfill`, once;
    - `?action=ig-rec`, Sunday windows only;
    - a probe part `?only=ig`.
  - A new map row, a reference section and `index.test.ts` pins go with it.
- **Secrets.** Davies stores them; they are never printed and never moved:
  - `IG_DEMO_API_KEY`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`;
  - later `IG_API_KEY`, `IG_USERNAME`, `IG_PASSWORD`.
  - An `IG_ENV` of `demo` is the default, and live needs a config row armed on his word. The client scrubs the key and
    the tokens from every message and error.
- **Session.**
  - Log in with `POST /session` (version 2) and keep `CST` / `X-SECURITY-TOKEN` and the `lightstreamerEndpoint` in the
    isolate's memory only, never in a table.
  - Log in again on a 401 (weekend maintenance invalidates every token).
  - Pick the spread-bet account with `PUT /session` when the default is the CFD one.
- **Rate governor.**
  - The budgets are 30 non-trading requests a minute per account, 60 per app and 100 trading.
  - History is 10,000 points a week, tracked from each reply's `remainingAllowance`.
  - The governor is a lease plus a per-minute counter, as PR5's POST governor is.
  - A 1-second REST poll would need 60 requests a minute, twice the per-account limit, so the recorder must stream.
- **Streaming.**
  - One Lightstreamer connection (IG: no concurrent connections), with two subscriptions:
    - a DISTINCT subscription to `CHART:<epic>:TICK` with `BID`, `OFR` and `UTM` (every tick, epoch milliseconds);
    - a MERGE subscription to `MARKET:<epic>` for `MARKET_STATE` (`TRADEABLE`, `EDIT`, `CLOSED`…), so we know when
      the first quote is dealable.
  - Run it either:
    - (a) inside an Edge call each minute that holds the stream for about 50 s under a lease (light CPU; the 2 s CPU
      limit binds on parsing, not on waiting); or
    - (b) in the Cloudflare Worker with a Durable Object for continuous coverage. That is Davies' call to deploy.
  - Ticks are written as gzip'd frames, as `pm_book_rec` does.
- **Probe** (`?only=ig`, places nothing): it reads
  - `GET /accounts` (types, product codes, currency);
  - `GET /markets?searchTerm=` for AUD/USD and the weekend markets (epic, `instrumentType`, `expiry`, `marketStatus`,
    `streamingPricesAvailable`, `dealingRules` minimum size and stop distances);
  - one `GET /prices/{epic}` (allowance fields);
  - `GET /repeat-dealing-window`.
- **Orders, later and demo first.**
  - `POST /positions/otc` (version 2) carries `expiry: "DFB"`, `currencyCode: "GBP"`, `forceOpen: true`,
    `guaranteedStop: false`, `orderType: "LIMIT"`, `timeInForce: "FILL_OR_KILL"` and a level.
  - It also carries a `dealReference` written to our table BEFORE the send, then read back with
    `GET /confirms/{dealReference}`. As go-live audit D3: an unknown stays pending, never rejected on a guess.
  - A take-profit is the position's own `limitLevel`.
  - **Before any live automated deal: IG's written consent under Term 9(12).**

## What was not done or not checked

- **No IG price was read.** There is no key. Every IG figure here is IG's published table, not a measured quote.
  - IG's Sunday-open AUD/USD spread is unknown: no public record or community evidence was found.
  - Its weekend markets' history is not public.
- **The FCA's leverage tiers** came from the ESMA-era summary, not re-read at source. IG's own margins were read.
- **The binary-options ban** is from memory; its FCA page was not found on 2026-10-09.
- **Not resolved:**
  - whether knock-outs, sprint markets and the weekend markets are offered on a UK retail account and through the API;
  - the VIX bet's minimum stake;
  - whether IG offsets margin for an option spread.
- **Option prices.** No option prices at IG were seen. The straddle results hinge on k, the ratio of at-the-money vol
  to VIX1D or VIX9D, which is unmeasured. CBOE's benchmarks are mid- or VWAP-based.
- **CNDR's wing width** is an estimate from the VIX's 2011–2026 median, not from CBOE's strikes.
- **Proxies.**
  - The index arms use ETF and index opening prints. IG's price at the open follows the futures, and its fills there
    were not measured.
  - UK 100 runs from 2009 only (ISF.L).
  - The FTSE dividend-yield function stays in the script for the first-run variant and is not used.
- **Not scored:**
  - the futures-bet version of the overnight trade;
  - BoE announcement days (no keyless MPC date list was pulled);
  - oil roll;
  - dividend-estimate bias.
- **Irish tax** on spread-bet winnings was not checked.
- **No production table was read.** Nothing was placed, cancelled, funded or signed up for.

## Files

- `docs/agents/backtests/ig_research/`: scripts, inputs, results and `MANIFEST.json` (the sha256 of every file).
- The quoted pages are in `inputs/ig_pages/`.
- FXW-IG reads STATARB-2's committed `../statarb_search2/inputs/fx/fxcm_AUDUSD_weekends.csv.gz`.
