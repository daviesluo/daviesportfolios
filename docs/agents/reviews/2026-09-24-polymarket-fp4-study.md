# Polymarket from first principles — the fourth programme (fp4), 2026-09-24

Davies asked for a fourth independent search, this time on Polymarket, where he holds an account (a Magic/email
proxy wallet on Polygon; another session built its read-only probe, reference §2d). The brief was the earlier
programmes' method exactly: brainstorm widely, kill ideas by arithmetic first, pre-register every survivor and commit
the pre-registration before running it, run it once, report what fails. Public data only: no key was read or used,
no signed call was made, nothing was placed. Every number below comes from a script in `backtests/polymarket/scripts/`
and every input is hashed in `backtests/polymarket/MANIFEST.json`. Reference §3.33 is the summary.

## The answer

**Nothing on Polymarket may run from Davies' account, and neither of the two rules tested so far is worth money in
any case** (the third, RW, is pending: its forward window ends at 10:42 UTC).

* **Access comes first (§0).** The United Kingdom is close-only on Polymarket's API as well as its website. Its Terms
  of Use go further: trading "IS NOT PERMITTED BY PERSONS OR ENTITIES WHO RESIDE IN, ARE LOCATED IN" 22 named
  places, **the United Kingdom and Ireland among them**, API use included, and "THERE ARE NO EXCEPTIONS". The geoblock
  page's "the API itself is not restricted" for Ireland describes what the servers enforce, not what the Terms allow.
  Davies lives in both countries, so the order path proposed for his Irish stretches — Supabase's Ireland region,
  only while he attests he is there — would still breach the Terms, and the stated consequence is the wallet in
  close-only mode. Nothing here proposes a way around it. Only Polymarket can change it, by changing both its Terms
  and its geoblock list; no venue regulated for UK or Irish residents that lists these markets was verified.
* **FAV — the favourite–longshot bias — fails.** Buying the 0.90–0.99 side a day before a market's scheduled end
  and holding it to resolution, filled only from real prints and charged the market's taker fee: out of sample
  (2026-01 → 09-10, one event in four) **−$292.15 on 2,282 trades of $10, −1.4 % a dollar**. The favourites won
  95.1 % of the time at an average fill of 96.3 ¢; a calibrated market would have cost only the fees (the null's
  95th percentile +$106.96). A week before the end it loses less (−$55.49 on 334), an hour before much more
  (−$910.51 on 2,538). On Polymarket in 2026 the bias ran the other way: tokens at 0.90–0.95 paid 0.888, longshots at
  0.05–0.10 paid 0.096.
* **WX — a free weather forecast against the daily temperature markets — fails.** Open-Meteo's 48-hour forecast with
  an error model fitted on 2025, trading the bucket it called ten points mispriced: **−$1,589.09 on 5,336 trades of
  $5, −6.6 % a dollar**. On 106,666 buckets the market's own price a day ahead scores a Brier of 0.064 and the model
  0.075: the thin, retail temperature books already price the forecast, and better.
* **RW — two-sided quotes for the liquidity rewards — (pending: RW's forward window ends at 10:42 UTC).** (pending: RW's forward window ends at 10:42 UTC)
* **The other 26 ideas die on arithmetic or a measurement** (§3, §4): the hourly crypto up/down markets look
  beatable against the price HISTORY and lose 2.8 ¢ a share at the real prints (the history lagged the book by 12 ¢);
  no negative-risk set is worth buying (the one large "edge" was an "Other if unknown" clause read as a price); 16
  ladder violations after fees, none worth 1 ¢ a share; a $10 taker-tier bonus costs about $61 of fees; the oracle
  overturns a first proposal about once in 3,700 markets, so it is not where near-certain outcomes lose.
* **If a country were ever lifted:** the two hold-to-resolution rules (FAV, WX) would survive stretches of
  reduce-only; the quoting rule (RW) would not. None of the three has an edge to take there.

**The finding that matters beyond this search: Polymarket's price history is not a price anyone could trade.** The
history endpoints serve the midpoint at a lag; on fast markets the first real print sat 12 ¢ from the history point,
and a rule that "made" 10 ¢ a share against the history lost 2.8 ¢ at the prints. Every fill in this study comes
from prints strictly through, floored one tick over the history price.

## 0. Can this account open a position on Polymarket? No — not from the UK, and not from Ireland either

Two documents decide it, and they say different things about Ireland.

* **Polymarket's geoblock page** (`docs.polymarket.com/api-reference/geoblock`, read 2026-09-24) describes what its
  servers enforce, by the requesting address. The United Kingdom (`GB`) is in "Regulatory-Restricted Jurisdictions
  (Close-Only on Frontend and API)": "Users can close existing positions but cannot open new ones, on both the
  frontend and the API". Ireland (`IE`) is in "Regulatory-Restricted Jurisdictions (Close-Only on Frontend)":
  "Close-only on the Polymarket frontend; the API itself is not restricted" — with Japan, the Netherlands, South Korea
  and Malta (sports only). The OFAC list is blocked outright. The page gives Polymarket's primary servers as AWS
  eu-west-2 (London) and "Closest Non-Georestricted Region: eu-west-1" (Ireland).
* **Polymarket's Terms of Use** (effective 2026-08-11; the document `polymarket.com/tos` frames, read 2026-09-24
  06:45 UTC, sha256 `0506de1e…847d` of its text export) say who may trade, and bind "INCLUDING BY CONNECTING VIA AN
  API". Their introduction: "USE OF THE SITE, PLATFORM OR TECHNOLOGY FEATURES FOR TRADING IS NOT PERMITTED BY
  PERSONS OR ENTITIES WHO RESIDE IN, ARE LOCATED IN, […] OR HAVE THEIR PRINCIPAL PLACE OF BUSINESS IN THE UNITED
  STATES OF AMERICA, ALBERTA, AUSTRALIA, BELGIUM, BRITISH COLUMBIA, FRANCE, GERMANY, HUNGARY, **IRELAND**, ITALY,
  ONTARIO, POLAND, QUEBEC, RUSSIA, SINGAPORE, SLOVAKIA, SLOVENIA, TAIWAN, THAILAND, THE NETHERLANDS, NEW ZEALAND, **THE
  UNITED KINGDOM**, OR ANY OTHER RESTRICTED TERRITORY […] (A "RESTRICTED PERSON")", then "THERE ARE NO EXCEPTIONS;
  THEREFORE, IF YOU ARE A RESTRICTED PERSON, THEN DO NOT ATTEMPT TO USE THE SITE, PLATFORM OR ANY OF THE TECHNOLOGY
  FEATURES TO TRADE", and "ANY PERSON IN VIOLATION OF THESE TERMS MAY HAVE THEIR WALLETS PLACED IN CLOSE-ONLY MODE".
  Their "Restricted Jurisdictions" clause adds anyone "residing in, a citizen of, organized in or located in any
  jurisdiction identified as a restricted jurisdiction on the list published at
  https://docs.polymarket.com/api-reference/geoblock" — the list that names both countries.
* **The site's own attestation**, shown before a first trade: "attest you are not a U.S. person, are not located in
  the U.S. and are not the resident of or located in a restricted jurisdiction"; "The US, Ontario, GB, and OFAC
  sanctioned territories are restricted jurisdictions". A self-certification request asks for "Proof of current
  residence: Recent utility bill, bank bill, or phone bill in a non-restricted jurisdiction", on pain of close-only
  mode within 14 days.

**What that means for Davies.** The geoblock page's "the API itself is not restricted" is what the servers let an
Irish address do; the Terms are what the account holder agreed to, and they turn on residence as well as location.
Davies resides in the United Kingdom and in Ireland (his word, 2026-09-24): under the Terms he is a Restricted Person
wherever he is standing, twice over, and "there are no exceptions". So the order path the coordinator described on
Davies' behalf — orders sent from Supabase's Ireland region only while his attestation says he is in Ireland, and
reduce-or-close only otherwise — would still breach the Terms, and its named consequence is the wallet in close-only
mode. This search found no lawful way for this account to open a Polymarket position today and proposes none: no
other region, no proxy, no one else's account, no reading of "API" against "frontend". The change that would open
one is Polymarket's own — dropping the United Kingdom (and, for the Irish stretches, Ireland) from both its Terms and
its geoblock list. No venue regulated for UK or Irish residents that lists these markets was verified from primary
sources in this search, so none is named.

**Why the economics are still here.** Davies asked whether an edge exists at all, the paper tests need only public
data, and a verdict of "no edge" is worth having before anyone argues about access. Every row of §3 carries two
extra answers: whether it is runnable from this account (no, for every row, for the reasons above), and whether the
rule would survive long stretches in which it may only reduce or close — the shape Davies' split residence would give
it if Ireland alone were ever lifted. A hold-to-resolution rule with occasional entries can sit out a stretch; a rule
that must re-quote or rebalance every minute cannot.

## 1. What the venue is, verified (docs.polymarket.com and the public endpoints, read 2026-09-24)

| subject | what holds today | source |
|---|---|---|
| Who may trade | The servers (geoblock page): United Kingdom **close-only on the frontend AND the API** ("can close existing positions but cannot open new ones"); close-only on both for 37 jurisdictions incl. GB, US, FR, DE, IT, PL, AU, SG, TH, TW, CA-ON/BC/AB/QC; close-only on the frontend only ("the API itself is not restricted") for IE, JP, NL, KR, MT (sports); OFAC list blocked. `GET polymarket.com/api/geoblock` answers per IP (this machine: `blocked: true`, US-OH). The Terms of Use (effective 2026-08-11): trading "IS NOT PERMITTED BY PERSONS OR ENTITIES WHO RESIDE IN, ARE LOCATED IN" 22 named places **including Ireland and the United Kingdom**, "THERE ARE NO EXCEPTIONS", API use included; a wallet in breach can be put in close-only mode. Primary servers: AWS eu-west-2. (§0) | `api-reference/geoblock`; Terms of Use (`polymarket.com/tos`); the site's interface strings |
| Taker fees (Fee Structure V2, 2026-03-30) | `fee = shares × rate × p × (1 − p)`, set at match time, takers only. rate: crypto 0.07, sports 0.05 (0.03 until 2026-07-10, which markets created before keep: 3,535 open), finance/politics/mentions/tech 0.04, economics/culture/weather/other 0.05, geopolitics 0. The live schedules on 194,929 open markets match the table exactly (M1). At 50 ¢ a crypto taker pays 1.75 ¢ a share, 3.5 % of the notional; at 95 ¢ a sports taker pays 0.24 ¢. | `trading/fees`, `changelog/predictions`, M1 |
| Maker rebates | makers pay nothing; a share of the taker fees (crypto 20 %, sports 15 %, others 25 %) is paid back daily, per market, in proportion to each maker's filled "fee-equivalent" (`rate × p × (1 − p)` per filled share); $1 minimum payout | `programs/maker-rebates` |
| Taker rebates | from 2026-05-28: tiers on 30-day weighted volume `size × (1 − price) × category weight` (sports 1.0 … crypto 2.3, geopolitics 0); Bronze $2,000 → 3 %, up to Obsidian $10 M → 50 %; one-time bonuses $10 … $25,000 | `programs/taker-rebates` |
| Liquidity rewards | per-market daily pools; an order scores `((v − s)/v)² × size` within `v` cents of the size-cutoff-adjusted midpoint and at least the minimum size (shares); two-sided depth scores in full, one-sided a third (and nothing outside [0.10, 0.90]); sampled once a minute at a random offset; split pro rata of each maker's summed score; paid daily at midnight UTC; $1 minimum. Live: 16,075 markets, **$147,864 a day** (sponsored $301), median $3, p90 $20, max $1,008; minimum size 20 shares on 76 % of them, `v` 4.5 ¢ on 76 %. The public `market_competitiveness` (undocumented) moves with the book's summed score: on ten markets it was 0.9–11 × (the smaller side's score ÷ 1,000), so it is not an instantaneous copy of the book. | `programs/liquidity-rewards`, `/rewards/markets/current`, `/rewards/markets/multi`, M1 |
| Holding rewards | 4.00 % a year on position value in eligible markets, sampled hourly, paid daily, variable (309 open markets) | `concepts/positions-tokens`, M1 |
| The book | one book per market: a YES bid at `p` is a NO ask at `1 − p` of the same size (400 of 400 checked); a YES buy and a NO buy match by minting a pair. Tick 0.01 on 167,415 open markets, 0.001 on 28,553, 0.0025 on World Cup lines; minimum order 5 shares (the CLOB's docs; Gamma's field description says USDC). Post-only, GTD (≥ 3 minutes, expires a minute early), FOK/FAK; a taker delay of 150 ms on crypto markets (since 2026-09-04) and 1–3 s on 126,455 sports markets | `trading/place-orders`, `concepts/prices-orderbook`, `changelog`, M1 |
| Negative risk | a NO in one outcome of a mutually exclusive set converts to a YES in every other (the Neg Risk Adapter); "augmented" sets add placeholders and an "Other" whose meaning narrows as placeholders are named | `concepts/negative-risk` |
| Resolution | UMA's optimistic oracle: a proposer posts a bond (the docs: "typically $750"; on the open markets `umaBond`/`umaReward` is $250/$0.80 on 144,096 of 196,098, $500/$5 on 32,142, $500/$3.50 on 6,969), 2-hour challenge; one dispute → a second proposal; two → UMA's DVM vote (24–48 h debate + ~48 h vote; 4–6 days in all); outcomes include 50-50. Crypto up/down markets resolve on Chainlink (TWAP since 2026-08-07: 30 s → 60 s for 5-minute, 60 s for 15-minute and 4-hour); hourly ones on Binance's 1-hour candle | `concepts/resolution`, `changelog`, market rules |
| Collateral, funding | pUSD (a USDC-backed ERC-20 on Polygon, since CLOB V2 on 2026-04-28); winners redeem 1:1. Bridge quotes for $100 (public `POST bridge.polymarket.com/quote`, read 03:00 UTC): Polygon USDC → pUSD $0.03, pUSD → Polygon USDC $0.03 of gas, pUSD → Base USDC $0.13 | `concepts/pusd`, `trading/bridge/*` |
| Rate limits | generous: `POST /order` 500 a second burst, 200 sustained; books 1,500 per 10 s | `api-reference/rate-limits` |
| History a keyless reader can get | Gamma: every market, open and closed, with its final payout; CLOB batch price history, hourly for 2025 markets; `/v2/prices-history` (1-minute ≥ 7 days, 5-minute ≥ 60, 30-minute ≥ 90, 3-hour and 12-hour permanent); every trade (`/v2/trades`, 3 years per market or event, maker rows optional); per-wallet P&L split (`/v2/user-stats`); resolution lifecycles (`/v2/resolutions`). The Goldsky order-book subgraph is paused since the V2 migration | the endpoints themselves |

## 2. Where a return could come from on Polymarket

A trade pays only when someone accepts a worse price than fair, or pays for a risk or a service. On Polymarket
that someone is one of five:

1. **A taker in a hurry**, who pays the half-spread and the taker fee. The maker keeps the half-spread and part of
   the fee (rebates); the maker's cost is adverse selection — being hit by those who know more.
2. **Polymarket itself**, which pays for liquidity ($147,864 a day of liquidity rewards, 15–25 % of taker fees back
   to makers, 4 % a year on eligible positions) and for taker volume (tier rebates).
3. **A bettor with a preference** — the lottery ticket, the home team, the round number — who accepts odds worse
   than fair. The favourite–longshot bias is the documented form.
4. **A trader without the information a free model has**: a numerical weather forecast, a spot price and its
   volatility.
5. **Whoever holds an inconsistent price** across markets that are tied together by construction: the two sides of
   one market, a mutually exclusive set, a ladder of strikes or dates.

And one risk someone must carry: **the oracle**. A near-certain outcome still has to be proposed, survive a
2-hour challenge and sometimes a vote before it pays; whoever holds it until then is paid for that risk, or not.

What the account brings: a loop that looks once a minute, tens to a few hundred dollars, and the public data this
repository already reads (Binance, Kraken) plus any keyless source (Open-Meteo). It is faster than nobody, larger
than nobody, and — the first finding — not allowed to open a position (§0).

## 3. The ideas, and what decides each

B = a bias or information idea, P = a programme, S = structure. Costs are Polymarket's own (§1): a taker pays
`rate × p × (1 − p)` a share (crypto 0.07, sports 0.05, finance/politics/mentions/tech 0.04, economics/culture/
weather/other 0.05, geopolitics 0); a maker pays nothing and gets back 15–25 % of the taker fees its fills generated,
in proportion to its fee-equivalent, paid daily above $1. "Per $ a day" is after those costs at this account's size
(tens to a few hundred dollars). **Runnable from Davies' account: no, for every row** — the United Kingdom is
close-only on the API, and the Terms of Use bar residents of the United Kingdom and of Ireland from trading (§0). The
last column answers the coordinator's second question: would the rule survive long stretches in which it may only
reduce or close?

| # | idea | the deciding numbers | verdict | survives reduce-only stretches? |
|---|---|---|---|---|
| P1 | Quote both sides of rewarded markets at the minimum qualifying size, for the **liquidity rewards** | $147,864 a day of pools over 16,075 markets (M1); a one-snapshot share put $100 at ~$340 a day, the number most likely to be wrong; the 400 largest makers on the richest pools hold $6.78 M of rewards lifetime beside $16.7 M of trade P&L and $9.1 M of fees paid (M4), and the small ones mostly lose | (pending: RW's forward window ends at 10:42 UTC) | **no**: it quotes both sides every minute; reduce-only, it can offer only what it holds, earns one-sided scores at best, and carries its inventory unhedged |
| P2 | Maker rebates alone | a filled maker share earns `rebate × rate × p(1 − p)`: $0.0025 at 50 ¢ in politics (0.5 % of the notional), 0.7 % in crypto, 0.375 % in sports — at one turnover a day at most $0.005 per $ a day before adverse selection; paid only on fills, which are the adverse part; the $1 daily minimum needs ~400 filled shares a day | **dead** as a strategy (an add-on to P1, which RW leaves out, conservatively) | no |
| P3 | Taker rebate tiers and level-up bonuses | Bronze needs $2,000 of weighted volume in 30 days; the cheapest route (crypto at 5 ¢, weight 2.3) is $915 of trades paying 6.65 % of notional in fees: $61 of fees for a $10 bonus and a 3 % rebate (≈ −$0.05 per $ traded) | **dead** | no (a 30-day volume window) |
| P4 | **Holding rewards** (4.00 % a year on position value, 309 eligible markets) on the near-certain side of a long-dated market | 0.011 % a day on the position — cash's rate, on a position that can go to zero; the price carries it for both sides; what is left is FAV's calibration question at long horizons | **dead** as an edge (FAV's 168 h arm asks the question) | yes |
| P5 | Referral programme | income from other people's trading | **not a strategy** | — |
| P6 | Propose UMA resolutions for the proposer reward | the open markets' own terms: a $250 bond for $0.80 (144,096 markets) or $500 for $5 (32,142); the first valid proposal takes the reward, a wrong or early one forfeits the bond; needs a feed of outcomes and wins races only against slower proposers | **out of scope** (an oracle role, not a trade; not tested) | — |
| P7 | Polymarket Perps and their open-interest rewards | a derivatives product, outside this search's spot-and-event scope (the house rule since fp1); its own geography page lists no UK restriction, "additional restrictions may apply under … applicable law", not examined | **out of scope** | not examined |
| S1 | YES + NO below $1 (buy both, merge) or above $1 (split, sell both) | the book is ONE book: YES bid + NO ask = 1 at the same size on 400 of 400 markets (M1); a YES buy and a NO buy match by minting | **dead** by construction | — |
| S2 | Negative-risk sets away from 1 (buy every YES, or every NO through the adapter) | M5: per sweep two complete sets pay to buy every YES and one or two every NO after fees; the YES "edges" are a resolution clause read as a price (§4 M5) and 1.25 ¢ a set locked to 2027-02; the NO ones 0.14–0.21 ¢ a set | **dead** (M5) | yes (hold to resolution) |
| S3 | Augmented negative-risk sets whose named outcomes sum under 1 | "Other" and unnamed placeholders sit outside the named set by design | **not an arbitrage** | — |
| S4 | Strike and date ladders out of order | M6: 896 ladders, 11,889 rung pairs, 16 violations after fees, the largest 0.93 ¢ a share on longshots settling in 2027–28: well under 1 % a year on the capital a pair locks | **dead** (M6) | yes |
| S5 | The same event on Polymarket and another venue (Kalshi, Betfair) | two legs, one of them on a venue not verified for this account; one leg alone is an information bet | **dead** (access), untested | no (two legs kept in balance) |
| S6 | Combos (multi-leg RFQ) as a quoter | a market-maker role over an authenticated RFQ socket with last look | **out of scope** for a small account | no |
| B1 | **Favourite–longshot bias**: buy the 0.90–0.99 side a day before the scheduled end, hold to resolution | a taker pays 0.24 ¢ a share at 0.95 (0.05 × 0.95 × 0.05) against 5 ¢ of upside; the risks are resolution (M2) and calibration | **FAV fails** (§5): −$292.15 on 2,282 out-of-sample trades, −1.4 % a dollar, −0.27 % a day on peak capital; the favourites won 95.1 % at 96.3 ¢; worst case the stake | **yes**: entries are occasional and each trade resolves on its own; in a stretch it stops entering |
| B2 | The same a week before | capital locked seven times longer for the same few cents | **fails** (FAV's secondary): −$55.49 on 334 trades | yes |
| B3 | Near-certain outcomes in the last hour before the scheduled end | 1–10 ¢ of upside a share, hours to days of lock-up until settlement (M2); the tail is a dispute or a void | **fails** (FAV's secondary): −$910.51 on 2,538 trades, −3.7 % a dollar | yes |
| B4 | Buy the known winner after the event, before UMA settles (0.97–0.999) | ≤ 3 % a trade over 2 h – 2 days (M2: a median 2.3 h from the end to the close in sports, 30 h in politics), with a loss of 100 % when the feed or the oracle is wrong (0.27 overturns per 1,000 markets); needs a sports or news feed, where bots with the feed arrive first | **dead** for a once-a-minute loop without a feed | yes |
| B5 | **Daily temperature markets against a free public forecast** | retail flow, thin books (median $3.7 within 1 ¢), $18.4 k a day of reward pools; Open-Meteo archives its 24- and 48-hour-ahead forecasts from 2024 | **WX fails** (§5): −$1,589.09 on 5,336 out-of-sample trades, −6.6 % a dollar, −2.2 % a day on peak capital; the market's price out-forecasts the model (Brier 0.064 against 0.075); worst case the stake | **yes**: one entry per event, held ≤ 36 hours |
| B6 | Hourly crypto up/down against Binance (the hour's 1 h candle decides) | M3/M3b: a model that beats the price HISTORY loses at the prints that actually traded: −2.8 ¢ a share after fees, the book 12 ¢ from the history point | **dead** (M3b) | yes in shape |
| B7 | 5-minute, 15-minute and 4-hour crypto up/down | a one-minute 1σ move shifts an at-the-money binary by 0.399/√τ: 17.8 ¢ (5 m), 10.3 ¢ (15 m), 2.6 ¢ (4 h), against a 1 ¢ tick and a 1.75 ¢ fee at 50 ¢; Chainlink TWAP settlement; a 150 ms taker delay on crypto | **dead** (a quote is ten ticks stale after a minute; a taker needs > 2.25 ¢ of mispricing and M3b shows the book tracks Binance) | yes in shape |
| B8 | Daily/weekly crypto price levels and ranges against a Binance model | the same fee, slower markets (a 1σ minute ≈ 1 ¢ at a day); the makers read the same Binance | **dead** by M3b's result on the faster market; not tested apart | yes |
| B9 | Daily FX and commodity up/down (GBP/USD, USD/MXN, natural gas) | fee 0.04–0.07 × p(1 − p) ≈ 1–1.75 ¢ at 50 ¢; a public spot every maker reads; a handful of markets | **dead** (arithmetic) | yes |
| B10 | Fed and CPI markets against futures-implied odds | the reference (CME FedWatch) is not keyless; professionals price these | **dead** (no free reference) | yes |
| B11 | Mentions markets (what a speaker will say) | decided live, in seconds, by people listening | **dead** (speed) | yes in shape |
| B12 | Sports in play | a live feed and seconds matter; 126,455 sports markets carry a 1–3 s taker delay | **dead** (speed) | yes in shape |
| B13 | Sports before the game against bookmaker odds | no keyless odds feed; the sharp books are the reference professionals already use | **dead** (untestable keylessly) | yes |
| B14 | Stale books after news | a loop that looks once a minute is the last to see news | **dead** (speed) | yes in shape |
| B15 | A newly listed market's first prices | no fair value to set them against | **dead** (no model) | yes |
| B16 | Disputed resolutions: buy the proposed outcome while it is disputed | M2: 411 disputes in 344,229 markets over 21 months (about 20 a month), 318 of them (77 %) kept the first proposal; capital locked 4–6 days; the loss when wrong is the stake | **untested** (prices during disputes were not read) | yes |
| B17 | Follow the public leaderboard's best wallets | a trade feed minutes behind, survivorship in any leaderboard, the follower pays the leader's price plus the move | **untested** | partly (it can follow exits, not entries) |
| B18 | Farm activity for a possible token airdrop | no measurable expected value; wash trading breaks the terms | **not a strategy** | — |

## 4. Measurements (public, 2026-09-24; every script in `backtests/polymarket/scripts/`, every result in `results/`)

### M1 — the live venue in one snapshot (02:17–02:29 UTC; `m1_structure.py` → `results/m1_structure.json`)

196,098 open markets, 195,969 accepting orders, all of them flagged `restricted` (geo-restricted somewhere);
54,826 in negative-risk sets; 194,929 fee-enabled; 309 with holding rewards. Among markets with at least $1,000 of
24-hour volume (2,646 of them, $30.9 M a day between them), the YES book at that instant:

| fee category | markets | 24 h volume | median spread | p90 spread | median depth ≤ 1 ¢ of mid | ≤ 3 ¢ | one-tick books |
|---|---|---|---|---|---|---|---|
| sports (0.05) | 341 | $5.50 M | 1.0 ¢ | 12.0 ¢ | $399 | $2,329 | 60 % |
| politics (0.04) | 392 | $3.93 M | 1.0 ¢ | 3.0 ¢ | $338 | $2,202 | 70 % |
| crypto (0.07) | 285 | $3.46 M | 1.0 ¢ | 4.0 ¢ | $145 | $776 | 61 % |
| sports, older (0.03) | 157 | $1.78 M | 0.4 ¢ | 2.0 ¢ | $980 | $2,523 | 77 % |
| economics (0.05) | 85 | $1.67 M | 1.0 ¢ | 5.5 ¢ | $142 | $440 | 53 % |
| geopolitics (0) | 91 | $1.46 M | 1.0 ¢ | 2.0 ¢ | $8,950 | $47,464 | 79 % |
| culture (0.05) | 163 | $0.93 M | 1.0 ¢ | 5.0 ¢ | $41 | $187 | 63 % |
| weather (0.05) | 262 | $0.70 M | 2.0 ¢ | 5.0 ¢ | $4 | $25 | 34 % |
| finance (0.04) | 112 | $0.54 M | 1.1 ¢ | 6.0 ¢ | $75 | $413 | 50 % |
| tech (0.04) | 110 | $0.41 M | 2.0 ¢ | 8.4 ¢ | $23 | $203 | 45 % |

Reward pools by category ($ a day): politics 33,367, sports 22,000, weather 18,406, finance 13,177, culture 13,163,
mentions 11,111, tech 9,509, economics 9,002, crypto 4,047, geopolitics 2,278. The snapshot's naive reward estimate
(our minimum-size two-sided quote a tick inside the touch, every level of the book counted as competition) is
$17,477 a day across all 15,116 priced markets for $1.18 M of quotes, and $341.69 a day for the best $99.80 — a
number that treats one instant of the book as the whole day and assumes the pool is paid as the formula implies.
It is the reason RW exists, not a result.

### M2 — how markets resolve (`m2_resolution.py` → `results/m2_resolution.json`)

Every closed market with an end date from 2025-01 to 2026-09 and at least $5,000 of volume (crypto up/down one in
ten), with its resolution record from `/v2/resolutions`: 366,417 markets. Outside crypto up/down (344,229):

| | markets | disputed per 1,000 | first proposal overturned per 1,000 | payout not 0/1 per 1,000 | hours from scheduled end to close, median / p90 | closed before the scheduled end |
|---|---|---|---|---|---|---|
| all but up/down | 344,229 | 1.19 (411) | 0.27 (93) | 6.6 (2,270) | — | — |
| sports (the 0.03 and 0.05 schedules) | 130,956 | 0.1 | 0.04 | 11.2 | 2.3 / 4.5–5.6 | 35–37 % |
| weather | 44,085 | 0.07 | 0.02 | 0 | 9.8 / 20.1 | 9 % |
| crypto (fee schedule v2) | 11,385 | 0.09 | 0 | 0 | 1.0 / 3.7 | 7 % |
| culture | 4,999 | 1.6 | 0.6 | 0 | 2.1 / 26.8 | 34 % |
| politics | 3,000 | 10.3 | 2.7 | 0 | 30.2 / 702 | 14 % |
| mentions | 895 | 11.2 | 5.6 | 0 | 3.2 / 31.0 | 42 % |
| no fee type (mostly 2025) | 141,086 | 2.35 | 0.49 | 5.6 | 4.3 / 22.3 | 25 % |
| crypto up/down (1 in 10) | 22,188 | 0 | 0 | 0.05 | 0.01 / 1.1 | 0 % |

**The oracle is not where near-certain outcomes lose.** About one market in 3,700 has its first proposal
overturned; the risk sits where the question is loose — politics and mentions, where words and deadlines are argued
(the largest: "Will Zelenskyy wear a suit before July?", $242 M of volume, proposed Yes, settled No; three "Will
Trump say …" markets of 2026-05). Payouts other than 0 or 1 are postponed or cancelled games (sports pays 50-50).
Capital stays locked hours after the scheduled end — a median 2.3 h in sports, 9.8 h in weather, 30 h in politics
(the 90th percentile 29 days) — and a third of culture, sports and finance markets close BEFORE their scheduled end
because the result is known early. Of the 411 disputes, 318 (77 %) kept the first proposal (idea B16; the prices
during disputes were not read).

### M3 and M3b — hourly crypto up/down against Binance, and why the price history cannot be traded (`m3_updown_hourly.py` → `results/m3_updown_hourly.json`; `m3b_updown_prints.py` → `results/m3b_updown_prints.json`)

The hourly BTC, ETH, SOL and XRP "Up or Down" markets resolve on Binance's own 1-hour candle, so their fair
price inside the hour is a formula of Binance's price, the candle's open, the time left and the volatility:
`p* = Φ(ln(S/O) / (σ√τ))`. M3 set every 5-minute point of `/v2/prices-history` for the 5,272 such markets that
closed in the last 55 days (52,560 points) against `p*` from Binance's public 1-minute klines, with the model read
either up to five minutes AFTER the price point ("late", flattering the model) or AT its start ("early").

| | market price | model, early | model, late |
|---|---|---|---|
| Brier score (lower is better) | 0.1770 | 0.1758 | 0.1589 |

The market's own calibration is close (e.g. prices 0.90–1.00 averaged 0.956 and won 0.968), slightly under-confident
at the extremes. A taker buying whichever side the EARLY model favoured by at least 10 points, at the history price
plus half a cent and the 0.07 × p(1 − p) fee, "made" +10.4 ¢ a share over 3,700 signals. **That is an artefact.**
M3b took one market in eight (by a hash of its slug), found 441 such signals, and read what takers actually paid for
the favoured side in the next 60 seconds (`/v2/trades`): 228 signals had a print, the first print sat on average
**12.0 ¢ above the history point**, and bought there the rule made **−2.8 ¢ a share** after fees (BTC +3.5, ETH −3.8,
SOL −7.0, XRP −3.4). The live book had already followed Binance; the history point had not. Examples: a history
price of 0.495 against a first print of 0.61 with the model at 0.60; 0.505 against 0.93 with the model at 0.98.

**A finding for anyone who backtests Polymarket: the price history is not a tradable price.** On fast markets it
lags the book by minutes; it is safe for selection only in slow markets and never for fills. FAV and WX (below) take
every fill from prints and floor it at one tick over the history price, so a stale point can cost them a trade or
make them pay more, never make them pay less.

### M4 — who makes markets on the richest pools, and what they keep (`m4_makers.py` → `results/m4_makers.json`)

The top 25 rewarded markets by daily pool and a fixed sample of 25 more; two days of fills with maker rows; the
400 makers with the most filled maker volume there, read through `/v2/user-stats` (all-time, all markets;
addresses dropped from the committed file). They are the survivors of a competitive business, not a random draw:

| lifetime volume | makers | economic P&L > 0 | median | reward income | trade P&L | maker rebates | fees paid |
|---|---|---|---|---|---|---|---|
| < $50 k | 41 | 16 | −$125 | $808 | +$25,673 | $652 | −$3,669 |
| $50 k – $500 k | 108 | 71 | +$1,354 | $150,248 | +$898,719 | $16,494 | −$62,157 |
| $500 k – $5 M | 143 | 112 | +$17,595 | $1.36 M | +$5.30 M | $249,861 | −$310,694 |
| ≥ $5 M | 108 | 95 | +$181,601 | $5.27 M | +$10.45 M | $2.99 M | −$8.74 M |

The largest reward earners hold hundreds of thousands to over a million dollars of rewards each and many of them
give much of it back in trading: one wallet with $586 k of rewards shows −$308 k of trade P&L, another $501 k
against −$422 k. The rewards are real money; the small makers in the sample collected $808 between 41 of them.

### M5 — negative-risk sets, three sweeps (`m5_negrisk.py` → `results/m5_negrisk.json`)

Every open negative-risk event with books (7,104 events, about 54,700 books a sweep), swept at 02:45, 03:04 and
03:22 UTC. For each set, two trades priced at the touch with each leg's taker fee: buy one YES of every outcome
(pays exactly 1 if the set is complete) and buy one NO of every outcome (pays n − 1); the YES side is also walked
through the books for ten sets.

| | complete sets | augmented sets (placeholders and an "Other") |
|---|---|---|
| events a sweep | 3,542–3,560 | 1,975–1,986 |
| sum of YES asks: 5th percentile / median | 1.03 / 2.88 | 0.986 / 1.155 |
| sum of YES bids: median / 95th percentile | 0.10–0.11 / 0.978 | 0.89 / 0.99 |
| buy every YES pays after fees (a sweep) | 2 | 135–139 |
| buy every NO pays after fees (a sweep) | 1–2 | 1–2 |

The complete sets' asks sum to far more than 1 because most outcomes of a long list have a one-tick ask nobody
lifts. The two YES-side "edges" are the same two events in every sweep, and neither is an arbitrage: in the
Guinea-Bissau presidential set the twelve named candidates' asks sum to 0.557, and its rules say it "will resolve to
'Other'" if the result is not known by 2026-12-31 — the missing 0.44 is the market's price of that clause, which the
flags do not show (the set is not marked augmented; its placeholders have no seller); the other, a box-office
ranking, pays 1.25 ¢ a set, $0.125 on ten sets, for money locked until 2027-02. The NO-side cases pay 0.14–0.21 ¢ a
set. The augmented sets' asks sum below 1 because their unnamed outcomes are not in the sum, by design. **Nothing
here is worth buying**, and the only large numbers are resolution clauses read as prices.

### M6 — strike and date ladders (`m6_ladders.py` → `results/m6_ladders.json`)

896 ladders among the open non-negative-risk events (357 "above/over/at least X", 112 "below/dip to X", 427
"by <date>"), 11,889 pairs of rungs where one must be at least as likely as the other. Buying YES on the likelier
rung and NO on the other pays at least 1 in every state; after both taker fees, 16 pairs cost less than 1. The
largest is 0.93 ¢ a share (a 55- vs 66-senator ladder on a bill, settling in 2027), then 0.71 ¢ and 0.63 ¢ on
FDV-at-launch and unemployment ladders — longshots at 1.6–8.5 ¢ that settle in 2027–28, well under 1 % a year on
the capital a pair locks. The parser's first two drafts read "hit X" as upward and a "by Dec 31" date in the
wrong year; both were fixed before this count (the file keeps the fixed version).

## 5. The pre-registered tests

Each pre-registration was written and committed before its data existed or was read, and none changed after its
commit. Each test script reads only its committed input and ran twice with byte-identical output (sha256 below). The
deviations — every one on the data side, made before the test's prices were read, and none touching a frozen
parameter — are listed with each test.

| test | pre-registration | committed (UTC) | sha256 of the file | data |
|---|---|---|---|---|
| FAV | `2026-09-24-polymarket-fp4-prereg-fav-favourites.md` | `ee2acd3`, 02:41 | `559040ee…` | resolved markets 2025-01 → 2026-09-10; prices at the decision time; taker prints after it |
| RW | `2026-09-24-polymarket-fp4-prereg-rw-reward-quotes.md` | `ee2acd3`, 02:41 | `e177190d…` | FORWARD: books recorded every minute from 02:42 UTC for eight hours; the prints of those hours |
| WX | `2026-09-24-polymarket-fp4-prereg-wx-weather.md` | `1d5b92f`, 02:49 | `0f7c02cc…` | resolved temperature events 2025-01 → 2026-09-10; Open-Meteo's 48-hour-ahead forecasts; prices; prints |

### FAV — buy the 0.90–0.99 side a fixed time before the scheduled end, hold to resolution — FAILS: the favourites are overpriced at the prints

**The data.** 3,416,588 closed markets with an end date since 2025-01; 2,658,884 two-outcome markets with a book that
are not crypto up/down; 344,229 with at least $5,000 of volume; 324,466 ending inside the windows (2,133 of which paid
something other than 0 or 1, and are kept); 290,256 open at one of the decision times; **72,649 in the one-in-four
event sample** (IS 15,720, OOS1 30,038, OOS2 26,891; 60 % sports and 18 % weather by count). 11,078 print walks (27,142 pages),
one of them cut at its 400-page cap, 12.1 M prints.

**The primary (h = 24 h, $10 a trade):**

| | IS 2025 | OOS1 2026-01 → 05 | OOS2 2026-06 → 09-10 | OOS |
|---|---|---|---|---|
| trades | 579 | 1,271 | 1,011 | 2,282 |
| P&L | −$30.41 | −$100.94 | −$191.21 | **−$292.15** |
| per dollar of cost | −0.56 % | −0.84 % | −2.02 % | −1.36 % |
| won / average fill | 95.9 % / 96.1 ¢ | 95.8 % / 96.6 ¢ | 94.2 % / 96.0 ¢ | 95.1 % / 96.3 ¢ |
| taker fees | $11.79 | $20.83 | $18.07 | $38.90 |

**The bar: fails five of six.** OOS −$292.15 and both halves negative (1); the calibration null's 95th percentile is
+$106.96 and its mean −$38.31 — a calibrated market would have cost about the fees, and the rule lost seven times
that (2); stress (a tick worse, fees doubled) −$351.35 (3); 2,282 trades, the one condition met (4); two months of
nine positive (5); −99.8 % a year on the $424 of peak capital it held (6). Byte-identical twice.

**The secondary horizons fail the same way.** A week before: OOS −$55.49 on 334 trades (IS +$9.64 on 172), won
93.4 % at 95.3 ¢. An hour before: OOS **−$910.51** on 2,538 trades, −3.7 % a dollar, won 92.5 % at 95.8 ¢ — the
last hour's favourites are the most overpriced.

**Why.** The history price at the decision time is itself slightly off in the direction that hurts: out of sample,
tokens shown at 0.90–0.95 a day before the end paid 0.888 on average against a price of 0.926 (454 tokens), those at
0.95–1.00 paid 0.990 against 0.985 (1,050), and longshots at 0.05–0.10 paid 0.096 against 0.072 (2,818) — longshots
underpriced, favourites overpriced: **the reverse of the favourite–longshot bias**, in this sample. And the prints
after the decision time are the buyers who got there first: the fills average 96.35 ¢ against a shown price of
95.42 ¢. A descriptive check, not part of the test, splits the loss: had every fill been at the shown price — which
M3b says could not be traded — the out-of-sample result would still be −$95.10 (−$80.00 in the 0.90–0.95 band,
−$15.09 in 0.95–0.99), so about a third of the loss is the favourites' own price and two thirds the price the
prints demanded.
By band: 0.90–0.95 lost 2.3 % a dollar (857 trades, won 91.8 % at 93.9 ¢); 0.95–0.99 lost 0.8 % (1,425, 97.1 % at
97.8 ¢). By category: weather is 58 % of the out-of-sample cost and −$225.61 (1,317 trades); crypto −$61.37 (263);
politics −$44.75 (75); **sports +$74.15 on 299 trades (won 97.7 % at 95.1 ¢)** — the one sizeable positive group,
found after the fact, and not a result.

**Costed as a maker instead**, with no fee and a rebate of a quarter of the fee-equivalent, the same fills would lose
$243.6 rather than $292.15 (fees $38.90, rebate about $9.73) — and a resting bid is filled by sellers, not by the
buyers these prints are, so even that is generous. **Per dollar, capacity, worst case.** −0.27 % a day on the peak
capital. At $100 a trade the hour after the decision
time supplied $60 of prints on average (−1.0 % a dollar). A trade's worst case is its whole stake: the largest losses
are crypto price-range markets ("Bitcoin between $76,000 and $78,000 on April 17") bought at 0.90–0.92.
**Reduce-only stretches: it would survive them** (entries are occasional and every trade resolves by itself), which
does not help a rule that loses.

**Deviations (data side, all before any price was read unless said).**
1. Prints were walked one Gamma event at a time (`/v2/trades?event_id=`, which returns the same prints as walking each
   market of the event) instead of market by market: the same data, fewer requests.
2. **The test runs on one Gamma event in four**, chosen by its id (`event id % 4 == 0`, outcome-blind), because every
   candidate's prints would have taken about six hours of paced requests. The universe's counts are reported
   unsampled too.
3. The first draft of the universe dropped 50-50 and void payouts, against the pre-registration's "every payout
   counts"; it was caught against the text and fixed before any price was read.
4. Price reads were packed twenty tokens a request, each token still reading only its own window `[T_d − 6 h, T_d]`.
5. The data was pulled in two sessions: the container restarted at about 04:02 UTC; the price read resumed from its
   cache, and the months ended after 2026-06 were added to the universe then (the rule never saw an outcome).

### RW — minimum-size two-sided quotes for the liquidity rewards, forward — (pending: RW's forward window ends at 10:42 UTC)

`rw_collect.py` froze the universe at 02:42 UTC — the 2,821 markets with a pool of at least $10 a day that were
accepting orders, $110,051 a day of pools between them (1,654 with a 20-share minimum, 1,812 with a 4.5 ¢ spread) —
and recorded every one's book once a minute. After the window, `rw_after.py` pulled every print of those markets and
their state then. `rw_test.py` quotes the minimum qualifying size on both sides a tick inside the touch (never
through it), scores the quote against the recorded book each minute with the published formula, pays itself the
pool's per-minute share, fills itself only from prints strictly through its price, and marks what it holds at the
window's end.

(pending: RW's forward window ends at 10:42 UTC)

**Deviations.**
1. **The recorder missed 2 h 39 min of the eight hours**: the container restarted at about 04:02 UTC and the
   recorder ran again from 06:42 on its frozen universe. The pre-registration already says "Minutes the collector
   missed quote nothing", so the test ran on the (pending: RW's forward window ends at 10:42 UTC) minutes recorded (of 480), with no quotes, rewards or fills
   in the gap and any inventory carried across it. It was also restarted once at 03:10 UTC, between two rounds, on a
   helper that retries a dropped connection (a restart never rewrites a minute it has).
2. The pre-registration's disclosure says `market_competitiveness` "matched the book-computed score divided by 1,000
   on the two markets checked". On ten markets the ratio ran 0.9–11×: the field moves with the book's summed score,
   but it is not an instantaneous copy of it. The test does not read the field.

### WX — daily temperature markets against Open-Meteo's 48-hour forecast — FAILS: the market is the better forecaster

**The data.** 13,629 resolved temperature events since 2025-01 (143,764 buckets); 11,586 inside the windows with a
station (IS 1,447, OOS1 3,837, OOS2 6,302; 9,672 highest and 1,914 lowest), at 54 stations; Open-Meteo's 48-hour
forecast at every station; 116,668 of the 118,991 buckets open at the decision time priced; 11,586 event walks.

**The model**, fitted on 2025-01 → 2026-02 (all highest-temperature events: the lowest-temperature markets began in
2026, so they take the pooled fit, the pre-registration's last fallback): the observed high runs 0.8° above the
forecast's hourly high, σ 1.6 °C (416 events) and 3.35 °F (1,029); nine city groups have fits of their own (New York twice,
as "NYC" in 2025 and "New York City" after), σ 1.3 °C (Toronto) to 4.2 °F ("NYC"). One flaw of the frozen script, disclosed rather than fixed: it groups a city's
events without regard to unit, so London's own fit mixes its 2025 markets in °F with its later ones in °C — London
lost $31.54 of the $1,589.09 below, so it does not decide the result.

**The primary ($5 a trade, |edge| ≥ 0.10):**

| | IS | OOS1 2026-03 → 05 | OOS2 2026-06 → 09-10 | OOS |
|---|---|---|---|---|
| trades | 435 | 2,012 | 3,324 | 5,336 |
| P&L | −$30.47 | −$484.96 | −$1,104.14 | **−$1,589.09** |
| per dollar of cost | −1.6 % | −5.3 % | −7.4 % | −6.6 % |
| taker fees | $44.02 | $194.84 | $319.77 | $514.61 |

**The bar: fails five of six.** Both halves negative (1); the calibration null's mean is −$509.59 — a calibrated
market costs about the fees — and its 95th percentile +$98.95, while the rule lost three times the fees (2); stress
−$2,161.48 (3); 5,336 trades, the one condition met (4); one month of eight positive (5); −802 % a year on the $374.83
of peak capital it held (6). Byte-identical twice.

**Why: the market already knows the forecast, and more.** On the 106,666 out-of-sample buckets priced at the decision
time, the market's own price scores a Brier of **0.0637**, the model's probability **0.0746**. Where the two disagree
by ten points the market is mostly right: NO trades (4,858) lost 6.2 % a dollar, YES trades (478) 10.8 %; the
thresholds 0.05 (−$1,573.93) and 0.20 (−$1,127.16) lose the same way. The largest losses are the model at 0.73–0.89
against a market near 0 or 1 that was right (Seoul, 2026-04-12: the model 0.89 on a bucket priced 0.0225). Twelve of
52 cities were positive (Chengdu +$217.63 on 100 trades) — after the fact, not a result. What the test withheld from
the model, by design: the 48-hour forecast is a day older than the forecasts anyone could read at noon UTC the day
before (the rule used it because it is causal in every time zone of the list); whether a fresher forecast closes the
gap is a new question and would need a new pre-registration.

**Per dollar, capacity, worst case.** −2.2 % a day on the peak capital; a trade's worst case is its stake. The books
are thin: 4,453 signals found less than $1 of acceptable prints in the hour after the decision time. **Reduce-only
stretches: it would survive them** (one entry per event, held at most a day and a half).

**Deviations (data side, before any WX price or forecast was read).**
1. **The station parser read only Wunderground URLs.** From 2026-08 most temperature markets name the National
   Weather Service's time series page instead (`weather.gov/wrh/timeseries?site=kord`), whose `site` is the station's
   ICAO code; the pre-registration takes the station from "the resolution URL's ICAO code", so the parser reads both.
   Events without a station fell from 3,401 to 727 (the rest have an empty source field in a city other than New York,
   London or Hong Kong, for which the pre-registration names no station).
2. Price reads were packed: every bucket of every event sharing a decision time, twenty tokens a request.
3. Prints were walked per Gamma event (`/v2/trades?event_id=`) rather than per traded market — the same prints.

## 6. What outlasts the search

1. **Two documents govern access, and they disagree about Ireland.** The geoblock page describes what the servers
   enforce by address ("the API itself is not restricted" for Ireland); the Terms of Use describe who may trade at
   all, by residence or location, and name Ireland and the United Kingdom. Any future Polymarket work in this
   repository should start from the Terms, not the geoblock page (§0).
2. **The price history is not a tradable price.** `/v2/prices-history` and the batch history serve the midpoint (or
   the last trade when the spread is over 10 ¢) at a lag: on the hourly crypto markets the first real print after a
   history point sat 12.0 ¢ from it, and a rule that "made" +10.4 ¢ a share against the history lost 2.8 ¢ at the
   prints (M3b). Every fill in this study comes from prints strictly through, floored one tick over the history price.
3. **The liquidity rewards are real money that the fills take back.** $147,864 a day is paid to makers, and the 400
   busiest makers on the richest pools hold $6.78 M of it lifetime; their trade P&L and fees decide whether they
   keep it, and the small ones mostly do not (M4). (pending: RW's forward window ends at 10:42 UTC)
4. **A negative-risk set can carry an "Other" outcome without the flag.** The Guinea-Bissau presidential set is not
   marked augmented, yet its rules resolve to "Other" if the result is unknown by 2026-12-31: its named candidates'
   asks sum to 0.557 and the missing 0.44 is that clause's price (M5). Read the rules before reading a sum.
5. **The temperature markets changed their resolution source in 2026-08**: most now name the National Weather
   Service's time series page (`weather.gov/wrh/timeseries?site=…`) instead of Wunderground. A model fitted on the
   older markets is resolved against a different page on the newer ones.
6. **The oracle's terms on the open markets**: a $250 bond for a $0.80 reward on 144,096 of 196,098 (73 %), $500 for
   $5 on 32,142 (16 %), $500 for $3.50 on 6,969 (M1's snapshot) — the documentation's "typically $750" is not what
   most markets carry.

## 7. Checks

* **Order of work.** The three pre-registrations still hash to what their commits froze: FAV `559040ee…400f7f` and RW
  `e177190d…e052` (`ee2acd3`, 02:41:05 UTC), WX `0f7c02cc…b357` (`1d5b92f`, 02:49:44). RW's first book round was
  written at 02:42:21, after its commit. FAV's first price read began at 03:17:42, after its data-side fixes were
  committed (`b0f67fa`, 03:06); WX's first price read began at 06:59:48, after its station fix was committed
  (`6c77a39`, 06:50). Every test script was committed before its input existed.
* **Determinism.** Each test ran twice from its committed input with byte-identical output: FAV `4b202faf…630e`
  (input `88a57998…ce3f`), WX `2e87cb33…9d48` (input `890d805e…a948`), RW (pending: RW's forward window ends at 10:42 UTC).
* **Fills re-derived from a fresh read.** `check_samples.py` took each test's twenty sample trades (a fixed seed),
  read the market's prints again from `/v2/trades?condition=` — not from the pulls the inputs were built from — and
  matched every fill to a print at its second, on the right side, at or below the fill price and at least its size;
  it read each payout again from Gamma and recomputed the P&L. FAV: 28 of 28 fills found, 20 of 20 payouts agree, P&L
  equal to within 1.1 × 10⁻⁶ (`results/check_fav.txt`). WX: 26 of 26, 20 of 20, within 3.5 × 10⁻⁶
  (`results/check_wx.txt`). The first FAV check missed one fill by 1.1 × 10⁻⁷ — the sample rounds fill prices to six
  decimals — and the check now allows that rounding.
* **Not re-derived:** the measurements M1–M6 ran once each (their scripts and results are committed). The raw pulls
  (about 1 GB gzipped) are not committed; `MANIFEST.json` hashes them, and the terms and geoblock pages quoted in §0.

## 8. Files

| path (under `docs/agents/`) | what |
|---|---|
| `reviews/2026-09-24-polymarket-fp4-study.md` | this study |
| `reviews/2026-09-24-polymarket-fp4-prereg-{fav-favourites,rw-reward-quotes,wx-weather}.md` | the three pre-registrations, as committed |
| `backtests/polymarket/scripts/pmnet.py` | the keyless HTTP helper (paced, retried, read-only) and the streaming reader of the monthly pulls |
| `backtests/polymarket/scripts/snap_universe.py`, `pull_closed.py` | the live snapshot (M1's input) and the closed-market pulls, month by month |
| `backtests/polymarket/scripts/m1_structure.py` … `m6_ladders.py`, `m3b_updown_prints.py` | the measurements → `results/m*.json` |
| `backtests/polymarket/scripts/fav_{universe,prices,trades,inputs,test}.py` | FAV's data steps and test → `inputs/fav_inputs.json.gz`, `results/fav_run{1,2}.json` |
| `backtests/polymarket/scripts/rw_{collect,after,inputs,test}.py` | RW's forward recorder, its after-window pulls, its input builder and test → `inputs/rw_inputs.json.gz`, `results/rw_run{1,2}.json` |
| `backtests/polymarket/scripts/wx_{events,forecasts,prices,trades,inputs,test}.py` | WX's data steps and test → `inputs/wx_inputs.json.gz`, `results/wx_run{1,2}.json` |
| `backtests/polymarket/scripts/check_samples.py` | re-derives a test's sample trades from a fresh read of the public feeds → `results/check_{fav,wx}.txt` |
| `backtests/polymarket/scripts/build_manifest.py` → `MANIFEST.json` | sha256 and size of every committed file, and of every raw pull that is not committed |

The raw pulls (about 1 GB gzipped: every closed market since 2025-01, one snapshot of 196,098 open markets and their
books, the minute books, the prints, the forecasts) stay out of the repository; `PM_DATA` points the scripts at them
and `MANIFEST.json` records what they were. A script is run from the repository root, e.g.
`PM_DATA=<folder> python3 docs/agents/backtests/polymarket/scripts/fav_test.py docs/agents/backtests/polymarket/inputs/fav_inputs.json.gz out.json`.
