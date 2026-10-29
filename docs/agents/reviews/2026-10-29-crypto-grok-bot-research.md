# A Grok-driven crypto bot, long and short: venues, strategy and design (2026-10-29)

Davies, 2026-10-28: "我打算把币所的买卖交易也做成一套类似于用grokbot交易polymarkt/ig的系统，你也仔细深度研究下架构和策略，包括用什么币所，
并且最好long和short都可以做" — a Grok-driven crypto trading system like GROKPM (Polymarket) and IGBOT (IG demo spread bets):
research the architecture, the strategy and the exchange, ideally able to go both long and short. And, the same evening:
"交易所不限，比如我目前的很多海外交易所账户比如币安 hyperliquid等都是可以做空的" — the venue is not limited; he holds accounts at
overseas exchanges such as Binance and Hyperliquid that can short.

**What this is.** Research and a design, not a build. It covers which venues can carry long AND short for Davies, each
venue's own terms on who may use it, what each costs and how safe its keys and custody are; where a Grok-style analyst could
add value in crypto against what this repository has already measured; and a concrete architecture that reuses GROKPM's and
IGBOT's (Grok proposes, the server enforces the rules, an independent recorder, a desk ledger branch, a frozen
pre-registration, paper and testnet first). Its working name below is **CXBOT, "Crypto analyst"**; Davies names it.
Nothing was built; nothing was placed, cancelled or changed; no credential was read. Production was read once, read-only
(§4.1's trend-row query). Every other measurement is keyless public data, taken 2026-10-28 23:22–23:34 UTC from this
container, whose egress is in the US (`docs/agents/venue-survey.md` §0): a venue that answers it 451 or 403 is blocking the
US, which says nothing about London. **Nothing here routes around a venue's geoblock or terms**: no VPN, no proxy, no region
pinned to dodge a block. Each venue's terms are stated as written; whether Davies may use a venue is his decision, and
this is not legal or tax advice.

**The repository is public.** No balance or P&L of Davies' accounts is written here: a live figure is `[•]`. Paper and
backtest figures, counts, public prices, fees and strategy settings stay.

**[audit 2026-10-29]** An independent audit (`reviews/2026-10-29-crypto-grok-bot-audit.md`) checked this review on 2026-10-29; its corrections are marked "[audit 2026-10-29]" below and its design supersedes §4.4, §5.5–§5.7, §5.12 and §6 where they differ. Davies, the same day: he holds international accounts at Binance, Bybit, OKX and Hyperliquid that can short, whether his use complies with each venue's terms is his decision, and the venue is chosen for the strategy alone (the audit's §2: Hyperliquid, then Binance USDⓈ-M, OKX, Bybit); and Phase 1 (paper on live public data, no keys) starts now, with the forecast layer inside it (the audit's §4).

**Sources.** The venue survey (`docs/agents/venue-survey.md`, 2026-09-22/23, with its `[S…]` tags) and the agents reference
(`docs/agents/reference.md` §2, §2b, §3.3–§3.45, §3.55, §6) are the base; this review re-read what moves and says where it
changed. GROKPM's record is its pre-registration and reviews to `reviews/2026-10-28-grokpm-utilisation.md`; IGBOT's is
`reviews/2026-10-29-igbot-research.md`. Web pages read on 2026-10-28 are listed with their URLs at the end. A statement
from memory says so.

## 1. The answer in short

1. **Two routes carry long and short; Davies chooses between them.**
   - **UK-regulated-adjacent: Kraken's spot margin.** Every crypto derivative is banned for UK retail clients, but Kraken's
     UK page (updated 2026-10-19) says that on a crypto/fiat pair such as BTC/USD its UK restriction "applies to going long
     but not to shorting", and that crypto/crypto (ETH/BTC) is unrestricted. A UK retail account may short BTC/USD by
     borrowing BTC. Costly: 0.40 % / 0.80 % at the entry tier plus 0.01–0.02 % to open and every four hours, about 121 bps a
     three-day BTC short; no spot sandbox; legally contested (§2.1).
   - **Offshore perpetuals: Hyperliquid (recommended of these) or Binance.** Hyperliquid's terms (2026-06-15) exclude only
     US and Ontario residents and sanctioned territories; they do not exclude the UK. It is an on-chain venue with no FCA
     authorisation, so Davies would have none of the UK's protections, and the FCA's ban binds the firms that sell, not the
     buyer (general information, not legal advice). On this architecture it is the best fit by a distance: an **API wallet
     can trade but cannot withdraw**, so the key that holds the money never reaches the server; a public **testnet** runs
     the same API (it answered today, 213 markets); **isolated margin** per position; native stop and take-profit triggers;
     the deepest books measured today (BTC 0.12 bps wide, $3.7M–$6.8M within 10 bps, $2.28 billion traded in 24 h); 0.015 %
     maker / 0.045 % taker, so a round trip costs about 6 bps against Kraken's 121. Binance's futures work too (testnet
     answered; 0.02 % / 0.05 %) but its own position on UK users matters: it restricted UK users' derivatives in 2021, takes
     no new UK users since 2023-10-16, and a group of 1,692 UK investors filed a High Court claim (reported 2026-07-01)
     alleging it sold derivatives to UK retail without authorisation. What his account may do under Binance's terms is his
     to confirm in the account; nothing here is designed around it.
   - **[audit 2026-10-29]** Superseded by Davies' word (2026-10-29): his international accounts at Bybit and OKX can short; the audit ranks all four for the strategy.
   - **Excluded by their own terms or the venue's UK service:** Bybit (UK spot only, derivatives unavailable), OKX (UK users
     get OKX UK: no API, no derivatives), dYdX (its help centre lists the UK as restricted, close-only), Deribit (no UK
     retail), IG and Coinbase derivatives (professional clients only).
2. **Elective professional status** would open regulated UK derivatives (Kraken, Coinbase since 2026-08-11, IG, Deribit) and
   **is not recommended**: two of three genuine tests, and the retail protections go.
3. **Leverage and liquidation are bounded by the server, not by Grok** (§5.5): isolated margin only, at most 3×, a reduce-only
   stop resting on the venue from the moment the entry fills, the liquidation price kept at least 2.5 stop-distances beyond
   the stop (at 3× isolated it sits about 32 % away on BTC), the account funded with the budget alone.
4. **The evidence for an edge is absent, and in places against.** This repository's mechanical crypto rules failed in paper
   and live and are being retired today (§4.1); funding, implied-volatility and sizing gates failed; five derivative rules
   failed; token unlocks fail the power arithmetic; MSTR/BTC is closed. GROKPM has not shown that Grok forecasts better
   than a market price (against the last trade Grok scored worse). The base rate is against retail leverage (IG: 70 % of
   retail accounts lose; Kraken's Australian arm: about 81 % of margin customers lost, per the regulator's case, secondary).
5. **So the first step is not a trading bot; it is a forecast test that costs nothing.** Polymarket lists liquid daily
   crypto price markets ("Bitcoin above ___ on October 29?", 11 strikes, $390,774 traded in 24 h; "What price will Bitcoin
   hit in October?", $1.15M), whose prices are market probabilities for exactly the questions a bracket trade answers.
   **Phase 0**: Grok forecasts them on a schedule, the server scores each against the market's price at the same minute;
   no venue key, no order, no money. It passes only if Grok's Brier beats the market's on a clustered paired test (§4.4).
   **Phase 1** (after a pass): IGBOT's bracket bot on paper against Hyperliquid's mainnet tape, plus a signed integration
   rehearsal on Hyperliquid's testnet. **Phase 2** (a new pre-registration on Davies' word): a small live budget.
6. **If shorting is not wanted:** long/flat on Revolut X (0 % maker); a bearish view means not holding.
7. **Plainly: if the question is "will a Grok crypto bot make money", the evidence says don't build it yet.** If it is "can
   we find out cheaply whether Grok has an edge in crypto", yes: Phase 0, in four to eight weeks.

## 2. Venues

### 2.1 The UK rule, and what it leaves

- **The derivatives ban.** Since 2021-01-06 a firm may not sell, market or distribute to a UK retail client derivatives
  (CFDs, futures, options) or ETNs referencing an unregulated transferable cryptoasset (FCA PS20/10, COBS 22.6; venue survey
  §4 [S3]; reference §3.38). A spread bet is a contract for differences in law (from memory), so IG's crypto spread bets are
  inside it (IGBOT research §2.1). The rule binds the firm; it does not make a UK resident's own trade an offence
  (general information, from memory; not legal advice).
- **The 2025 opening.** From 2025-10-08 retail may buy crypto ETNs admitted to a UK recognised investment exchange: BTC and
  ETH notes, physically backed (summaries of the FCA's announcement; venue survey §6). No inverse or leveraged crypto ETN
  for UK retail was found. Since 2026-04-06 a Stocks & Shares ISA buys no new crypto ETN (reference §3.45). LSE hours only.
- **Spot margin is not on the ban's list**, and Kraken offers its crypto-borrow side to UK retail. **Not settled:** a margin
  position kept open with four-hourly rollover and settled in cash resembles a CFD; three claimant firms are investigating
  whether Kraken needed FCA authorisation for UK margin (no finding); in *Payward v Chechetkin* [2023] EWHC 1780 (Comm) the
  court refused to enforce a Kraken arbitration award against a UK consumer margin trader on FSMA and consumer-rights
  grounds. The practical risk is withdrawal: Kraken closed UK fiat margin at two weeks' notice in July 2024. The FCA's final
  crypto rules (June 2026; lending and borrowing in PS26/11) keep retail lending and borrowing, with appropriateness tests,
  over-collateralisation and negative balance protection, from 2027-10-25.
- **Why fiat margin is restricted and crypto is not** (inference): Kraken's two exemptions, a high-net-worth borrower (net
  income over £150,000 or net assets over £500,000, with an accountant's statement) and a business purpose, are the
  consumer-credit exemptions; lending money to a consumer is regulated credit, lending bitcoin is not.

### 2.2 Each venue's own terms on who may use it

| venue | its terms or UK service, as written | the source |
|---|---|---|
| **Hyperliquid** | "The Interface is not available to 'Restricted Persons'": persons who reside in, are located in or are incorporated in the United States or Ontario, persons in sanctioned territories, and citizens of those territories; outcome markets also exclude "Excluded Persons" it designates; the user is "solely responsible" for complying with local law; disputes go to LCIA arbitration in London. **The UK is not named.** | app.hyperliquid.xyz terms, "Last updated on June 15, 2026" (read from the page's `TermsOfUse` script) |
| **Binance** | No new UK users since 2023-10-16; existing UK users keep the services they had and get no new products [S104]. In 2021 Binance told UK users derivatives would be close-only unless they confirmed private-investor status (CoinDesk 2021-12-14). No Binance company is authorised in the UK; it must stop serving UK customers by 2027-10-25 unless authorised. A group claim by 1,692 UK investors (Binance Holdings, Nest Exchange, Changpeng Zhao; at least £150M) alleges it sold leveraged derivatives to UK retail without authorisation (reported 2026-07-01; unproven). | venue survey §11.1; CoinDesk; Crypto Daily |
| **Bybit** | Left the UK in 2021 to comply with the FCA ban; back since 2025-12-19 for spot and P2P only, under promotions approved by Archax; "not authorised, regulated, or registered by the FCA"; derivatives unavailable to UK users. | venue survey §3.1 [S12]; secondary reports |
| **OKX** | UK users are served by Aux Cayes FinTech (Seychelles): spot, fiat ramps and conversion; API, demo trading, bots and all derivatives unavailable in the UK. | venue survey §3.1 [S10]; OKX UK product table (mirror) |
| **dYdX** | Its operated frontends are "not available to users in certain restricted jurisdictions, including … the United Kingdom"; such users get close-only. | help.dydx.trade geo-restrictions |
| **Deribit** | "does not currently offer its services to UK Retail Clients". | venue survey §11.1 [S105] |
| **Kraken** | UK retail: spot; margin as §2.1; derivatives only for UK professional clients (Payward Digital Solutions, Bermuda, arranged by Crypto Facilities Ltd, FRN 757895). | Kraken support, 2026-10-19 and 2026-10-23 |
| **Coinbase, IG** | UK retail spot only; derivatives for professional clients (Coinbase from 2026-08-11; IG's crypto CFDs and spread bets). | FOW 2026-08-11 (paywalled); IG 2026-05-13 |

### 2.3 The venues that can short, side by side

| | **Hyperliquid perps** | **Binance USDⓈ-M** | **Kraken spot + margin** | Revolut X (long only) |
|---|---|---|---|---|
| long / short | both, perpetuals | both, perpetuals | long spot; short by borrowing the coin; ETH/BTC both ways | long |
| fees (entry tier) | 0.015 % maker / 0.045 % taker (tier 1 at $5M of 14-day volume) | 0.02 % / 0.05 % (Binance FAQ, 2026-04-28) | 0.40 % / 0.80 %; margin open + per 4 h: BTC 0.01–0.02 %, alts 0.02–0.04 %, USD 0.025–0.05 % | 0 % / 0.09 % |
| funding / carry | hourly, peer to peer, cap 4 % an hour; interest floor 0.01 % per 8 h, paid by longs at zero premium (BTC read 0.00125 % an hour today: ~3 bps a day) | every 8 h (**[audit 2026-10-29]** confirmed for BTC/ETH/SOL by Hyperliquid's `predictedFundings`; the same 0.01 %/8 h interest term, so the same ~3 bps a day to longs at a zero premium) | rollover as above, on the borrowed asset | none |
| liquidation | at maintenance margin = half the initial margin at max leverage (BTC max 40×: 1.25 %); book first, then the liquidator vault below 2/3 of maintenance; **no liquidation fee**; triggered on the mark price | isolated or cross; fee and ADL (from memory) | margin call 80 %, liquidation 40 % (margin level); **2 % fee** | — |
| max leverage today | BTC 40×, ETH 25×, SOL 20×, XRP 20× (`metaAndAssetCtxs`) | not read | 2–10× (USD pairs), 2–5× (GBP pairs); **2× is the minimum** for a margin order | — |
| isolated margin | per position (`updateLeverage`, `isCross` false) | per symbol (`marginType` ISOLATED) | margin positions share the account's collateral | — |
| liquidity today | BTC 0.12 bps, $3.7M bid / $6.8M ask within 10 bps (**[audit 2026-10-29]** these sum Hyperliquid's 20 full-precision levels, which span about 2.5 bps; within 10 bps it held $26.4M / $27.9M on 2026-10-29 00:14 UTC), $2.28B a day; ETH 0.42 bps, $11.8M / $13.8M, $758M; SOL 0.98 bps, $2.3M a side, $154M | not read (futures endpoint 451 from this container) | BTC 0.01 bps, ~$2.5M within 5 bps (reference §2b, 2026-09-20) | BTC 1.5–1.7 bps (reference §2.2) |
| API | REST + WebSocket; EIP-712 signatures (secp256k1); 1,200 request-weight a minute per IP; per address 10,000 actions to start plus 1 per USDC traded; 1,000 open orders | REST + WebSocket, HMAC or Ed25519 keys | REST (HMAC-SHA512); `leverage`, `reduce_only`, conditional `close[ordertype]`, `validate=true` | REST (Ed25519); 1,000 orders a day |
| orders the venue holds | stop market, stop limit, take profit, position TP/SL, reduce-only, post-only (ALO), IOC, GTC | `STOP_MARKET`, `TAKE_PROFIT_MARKET`, `closePosition`, reduce-only (from memory) | stop-loss, take-profit, trailing stops, conditional closes | `conditional`, `tpsl` |
| test environment | **testnet, same API** (`api.hyperliquid-testnet.xyz`, 200 today, 213 markets); thin books, for integration not fills | **futures testnet** (`testnet.binancefuture.com`, 200 today) | none for spot (`validate=true` only); the futures demo now 301s to a marketing page | none |
| key security | **API wallet: signs trades, cannot withdraw, transfer or approve agents** (third-party SDK docs; Hyperliquid's own page says agents "are only used to sign"); the master key stays in Davies' wallet; never reuse an agent address once deregistered (replay risk); no IP concept | trade-only key, withdrawals off; **IP allowlist impossible from Supabase Edge** (no fixed egress, [S107]) | trade-only key, withdrawals off; IP allowlist likewise impossible | Ed25519 key; per-key IP allowlist likewise impossible |
| account isolation | sub-accounts only after $100,000 of volume; a **fresh wallet** of the bot's own instead | sub-accounts (not read for his account) | spot sub-accounts institutional only: the whole account is the bot's | a sub-account (as PR5's `_2`) |
| custody and counterparty | on-chain: no exchange insolvency, but bridge, validator and governance risk (validators intervened in a market in March 2025, from memory); deposits and withdrawals in USDC over its bridge | a CEX: insolvency, freezes, a pending UK group claim; unauthorised in the UK | MLR-registered, no FSCS; UK margin's legality contested | MLR-registered, no FSCS |
| from London (eu-west-2) | not measured; the API answered this US container (its block is in the terms and the frontend) | spot answered 200 from eu-west-2 on 2026-09-23; futures not measured; 451 from this container | answered from everywhere measured | answered |

**Measured today, keyless** (23:22–23:34 UTC): Kraken `AssetPairs` and `Assets` (leverage lists, `margin_call` 80,
`margin_stop` 40, `margin_rate` XBT 0.01, ETH 0.02, SOL 0.02, USD 0.028, matching the fee page's per-4-hour percentages);
Kraken Futures tickers (BTC 81,248 / 81,249); `demo-futures.kraken.com` 301 to `kraken.com/gb/features/futures`; Deribit
testnet 200, its BTC perpetual's funding over 30 days 0.38 %; Hyperliquid `metaAndAssetCtxs` and `l2Book` (the figures above),
testnet `meta` (213 markets); Binance `fapi` 451, futures testnet 200, spot testnet 451; Bybit main and testnet 403; OKX
public 200; dYdX indexer 200. From this container only.

### 2.4 Elective professional status

- **The test** (COBS 3.5.3R, as Kraken states it, 2026-10-23): two of three plus a qualitative assessment: leveraged
  derivatives or structured products traded at least 10 times a quarter over four quarters in significant size (£10,000+ a
  trade in stocks or crypto); a financial portfolio over €500,000; a year in a financial job requiring knowledge of leveraged
  products. CP25/36 (2025-12-08) proposed dropping the quantitative test for a qualitative one and a £10m wealth route; no
  final rules were found.
- **Unlocks:** Kraken's UK derivatives, Coinbase's UK derivatives, IG's crypto CFDs and spread bets, Deribit.
  **Costs:** the derivatives ban, leverage caps and negative balance protection no longer protect him; the FCA has warned of
  firms pressing clients to opt up. **Recommendation: no**, unless he already genuinely meets two tests and wants it for his
  own reasons.

### 2.5 Ireland and the EU

Davies is resident in the UK and Ireland (reference §2d). EU derivative access is not assumed here; the Polymarket path stays
as it is, pinned to `eu-west-1` only under his standing attestation about where he is. **CXBOT runs from `eu-west-2`
(London), the region the project's cron calls reach by default, and is never pinned to a region to get round a venue's
block.** A venue that refuses London is out.

### 2.6 The venue answer

- **Primary for long and short, if Davies accepts its terms and the absence of UK protection: Hyperliquid perpetuals**, from
  a fresh wallet of the bot's own funded with the budget alone, an API wallet's key on the server (trade-only), isolated
  margin at ≤ 3×, the testnet for the signed rehearsal.
- **If he wants a UK-facing venue instead: Kraken** (long spot, short margin), at about twenty times Hyperliquid's cost a
  round trip, with the legal caveats of §2.1. Kraken holds no live strategy, so its account can be the bot's.
- **Binance** only if Davies confirms in his account that Binance's terms let it trade futures; its key would need futures
  switched on and could not be IP-bound from Supabase.
- **Not Bybit, OKX, dYdX or Deribit** (their own UK terms), and no elective professional step.
- **Long/flat fallback:** Revolut X at 0 % maker, on an account of the bot's own.

## 3. What a trade costs

Round trip = entry fee + exit fee (+ spread when taking), plus carry. Cost in units of the risk taken (R) = cost ÷ stop
distance. A bracket's driftless chance of reaching the limit first is m = d_stop / (d_stop + d_limit); with a round-trip
cost c the break-even probability is **p\* = (d_stop + c) / (d_stop + d_limit)**. A stop fills as a taker.

| leg (3-day hold) | round trip | carry | total | in R at a 3 % stop | at a 5 % stop |
|---|---:|---:|---:|---:|---:|
| Hyperliquid long, maker in, stop out | 6 bps (+0.1–1 spread) | +9 bps paid (~3 a day) | ~16 bps | 0.05 | 0.03 |
| Hyperliquid short, same | 6 bps | −9 bps received | ~−2 bps | ~0 | ~0 |
| Binance USDⓈ-M, maker in, stop out | 7 bps | funding, sign varies | ~7–16 bps | 0.02–0.05 | 0.01–0.03 |
| Revolut X long | 9 bps + ~2 spread | none | 11 bps | 0.04 | 0.02 |
| Kraken long, tier 1 | 120 bps | none | 120 bps | 0.40 | 0.24 |
| Kraken BTC short, tier 1 | 121 bps | 18 bps | 139 bps | 0.46 | 0.28 |
| Kraken ETH/SOL short, tier 1 | 122 bps | 36 bps | 158 bps | 0.53 | 0.32 |

At Kraken's entry tier a short costs half a unit of risk at a 3 % stop: a bracket at 2R and m 0.33 would need a true
probability of about 0.43 to break even. On a perpetual the same bracket's cost is noise. **Cost is the reason the perp
route is the practical one; it is not evidence of an edge.** Funding moves: at an extreme premium it can cost longs or shorts
far more than the floor (cap 4 % an hour), which is why the rules refuse an open against heavy funding (§5.5).

## 4. Strategy: where a Grok analyst could add value

### 4.1 What this repository already measured in crypto

| what | result | source |
|---|---|---|
| Trend rules (1h, 4h), long only, walk-forward | the shipped rule's worst window D −7.81 % (A +8.03, B +20.08, C +55.64 %); no gate or sizing variant beat its null | reference §3.3–§3.21 |
| The same rules in paper and live, 2026-09-21 → 10-28 (read-only SQL today on `agent_orders`, filled, net of fees; every row flat) | `trend-1h` paper: 12 round trips, −$47.69 on $1,000 (−4.8 %); `trend-4h` paper: 4, −$11.86 (−1.2 %); `trend-4h-live`: 1 round trip in five weeks, a loss of `[•]`. Being retired today | this review; ledger item 3 |
| Funding (UZERO, USOFR) as a BTC spot trade | FAIL: p 0.226 / 0.779; the edge gone since 2024 | §3.34 |
| DVOL and funding entry gates, volatility-sized slots | FAIL, all three | §3.21 |
| fp6: five derivative rules (ETH carry, altcoin carry, trend long/short on perps, short after Binance delisting, short new perps) | FAIL, all five. The trend rule long AND short on perps made the worst window worse in all four evaluations (−7.81 → −12.42 %). The delisting short made +$265.80 on 67 events at the hour and +$1,142 at 1 s (post hoc): a race | §3.38 |
| Maker-only rules; three first-principles searches | none passes | §3.23–§3.29 |
| Token unlocks | the drift after forced selling continues; a +2 % mean needs about 1,200 events | `reviews/2026-10-01-research-round.md` |
| MSTR/BTC, BMNR/ETH, treasury companies | closed: no arbitrage, every tradable form lost | §3.45 |
| Listing announcements | a race (FAST-A) | §3.44 |
| GROKPM (Grok on Polymarket) | every order correct; calibration not shown better than the market: on 4 resolved shadow forecasts the last trade scored Brier 0.0004 against Grok's 0.0019; sub-threshold forecasts 0.136 against the market's 0.106 on 9; its money came from a handful of B entries in quiet markets | `reviews/2026-10-23-grokpm-rules-study.md`, `2026-10-28-grokpm-utilisation.md` |

**Having a short side does not rescue a rule that fails long**: fp6's H4 put the trend rule on perpetuals in both directions
and its worst window got worse. A Grok bot loses on speed (a 15–60 minute wake against bots that react in milliseconds);
every mechanical crypto signal tried here failed; and GROKPM's one plausible edge, being early in markets few people watch,
does not exist on BTC, ETH or SOL.

### 4.2 The candidates

| candidate | why an LLM could help | why it may not | evidence | verdict |
|---|---|---|---|---|
| **Macro releases** (CPI, payrolls, FOMC): before and after | reads nowcasts and Fed speakers; judges whether a first move over- or under-shot | consensus is close to efficient; crypto reprices in seconds; IG's index event days were dead mechanically | none in crypto here | **allowed (E, R) with a T−10 to T+5 minute blackout**; Phase 0 measures it first |
| **Token unlocks** | reads the schedule, holders and hedging; a short makes the pre-unlock drift tradable | mid-cap perps are thinner and pay more funding; the published sag before unlocks is from memory (Keyrock 2024), not re-read; ~1,200 events for power | power fails | **not in Phase 1** (BTC, ETH, SOL only); a later mechanical study |
| **ETF flow days** | reads the flow tables | flows follow price and publish after it (from memory) | none | context only |
| **Listings and delistings** | reads the announcement | a race at 1 s (fp6 H5) | H5 at the hour failed its month rule | **no**: a mechanical rule's job |
| **Upgrades, forks, rulings** (scheduled) | judges content and "sell the news" | rare on three coins | none | allowed as E with a dated `event_at` |
| **Narrative and news** with defined risk | reads more than a person | priced before any wake; GROKPM's confirmations were priced 25 minutes to 9 hours before Grok looked | GROKPM: against | **allowed only as a slower thesis (N: days)** |
| **Funding and basis** (public on Hyperliquid, Kraken Futures, Deribit) | an extreme regime as context for a fade | UZERO/USOFR and the funding gate failed; fp6 H1 withdrawn, H2/H3 failed | §3.21, §3.34, §3.38 | a context field on every decision, and a rule against paying extreme funding |
| **Relative value: ETH against BTC** | judges a divergence's cause | a ratio's trend is as hard as a price's; untested here | none | **allowed (V)**: on perps a long ETH and short BTC of equal notional; a mechanical baseline beside it in the pre-registration |
| **Polymarket's crypto price markets** | the same forecast with the market's probability printed | the most liquid Polymarket crypto books, bot-made | GROKPM | **Phase 0's baseline**; trading them is GROKPM's lane |

### 4.3 The honest odds

My judgement, not a measurement: the chance that Grok's probabilities beat Polymarket's on daily BTC/ETH price questions by
enough to trade is **well under even, about one in five or less**. The reasons are the table above, GROKPM's scores, and
published work on retrieval-augmented LLM forecasters, which reports results near crowd aggregates rather than above them
(from memory). Phase 0 exists because that judgement is cheap to test and expensive to be wrong about.

### 4.4 Measuring it: calibration first, P&L second

- **Phase 0 forecasts.** At fixed horizons (24 h, 8 h and 2 h before each "Bitcoin above ___ on <date>" market resolves, and
  the same for ETH and SOL where listed), Grok gives p for each strike; the recorder writes the market's mid and last trade at
  that minute (score against both: GROKPM's lesson). Outcomes come from Polymarket's resolution. The barrier markets ("What
  price will Bitcoin hit …") are a second family: the touch probabilities a bracket uses.
- **The statistic.** d = (p − y)² − (q − y)² per forecast, q the market's price. **Strikes of one day share one path**, so
  the unit of evidence is the event-day: a cluster bootstrap over event-days of the mean d, one-sided, the log score beside it.
- **Power.** If Grok is right by 10 points where it disagrees (q 0.33, p 0.43, true chance 0.43), d is −0.124 or +0.076,
  mean −0.010, sd about 0.099: **about 400 independent forecasts give t ≈ 2**; with no skill the same disagreements give
  +0.010. Clustered by day, 400 independent forecasts is about 8 weeks of three coins at three horizons, or about 4 with the
  barrier family. A short run can show a gross failure, which is what most likely ends it.
- **[audit 2026-10-29]** **Scoring.** Excluding brackets that neither side reaches within the hold biases y down on crypto (a 2.5 %/5 % 72 h BTC bracket: P(limit first | resolved) 0.166 against m 0.333), and no-skill forecasters passed such a bar in 8–32 % of simulated windows. The audit's §5 scores a timeout at its fraction between stop and limit (E[y] = m exactly), on assigned brackets the forecaster does not choose.
- **Phase 1 brackets.** As IGBOT: every open is an entry, a stop and a limit; m from the server's levels, p\* with the cost;
  Grok's p must clear p\* + 0.08. Each real and shadow bracket resolves on the recorded tape. P&L needs far more: at +0.2 R a
  trade and a per-trade sd of about 1.5 R, t = 2 needs about 225 trades. **A six-week paper run cannot prove an edge in
  money**; it shows discipline, a gross failure, and calibration on brackets.

## 5. The architecture (CXBOT)

### 5.1 The shape

```
Grok (outside, scheduled wakes)                      Polymarket Gamma/CLOB (read)      Hyperliquid /info (read)
   │  Bearer CXBOT_TOKEN                                       ▲                       Hyperliquid testnet /exchange
   ▼                                                           │                       (Phase 1 rehearsal: signed)
 cxbot Edge Function (eu-west-2) ── ingest.ts (journal, request rules) ── rules.ts (CXBOT_RULES, pure)
   │                     exec.ts (context, lease, forecast / order / close / amend / cancel, sync)
   │                     paper.ts (fills on the recorded mainnet tape)      client.ts (host allowlist, EIP-712 signer)
   ▼
 Postgres: cxbot_config · cxbot_instruments · cxbot_events · cxbot_forecasts · cxbot_decisions · cxbot_cycles
           cxbot_daily · cxbot_requests · cxbot_orders · cxbot_positions · cxbot_snapshots · cxbot_tape · cxbot_exec_state
           (RLS on, no grant, no policy: `anon` and `authenticated` reach nothing, as every table since 0082)
   ▲
 pg_cron: edge_calls rows `cxbot?action=record` and `cxbot?action=sync`, every minute (beat first, watchdog retry)
```

### 5.2 Modes, by construction

- `cxbot_config.mode` under `check (mode in ('forecast', 'dry_run', 'paper', 'testnet'))`. **There is no live value, and no
  mainnet signing host on the client's allowlist**: in Phases 0–1 `client.ts` allows Polymarket's read endpoints,
  Hyperliquid's mainnet `/info` (read only), Kraken's and Deribit's public endpoints, and Hyperliquid's **testnet**
  `/exchange`, and refuses anything else before `fetch`, as IGBOT's `assertIgbotAllowed` does. The only signing key it reads
  in Phase 1 is a testnet API wallet's.
- `testnet` sends the same signed orders to Hyperliquid's testnet: order shapes, isolated leverage, triggers, cancels and the
  sync's read-back are proven there. Its fills are not scored (its books are thin); the record that counts is `paper`'s, on
  the mainnet tape.
- Phase 2 is a new pre-registration, Davies' word, a migration that adds `'live'` and the mainnet host, and the arm: one
  statement in that migration's header, run only in the conversation where he says go. The global pause outranks everything
  but cancels and exits.

### 5.3 Tables

| table | what | key fields |
|---|---|---|
| `cxbot_config` | one row: mode, budget (notional $1,000), `armed_at`, `started_at`, the stops' latches | `check` on mode |
| `cxbot_instruments` | the whitelist: venue, coin, sides, max leverage (≤ 3), size decimals, tick | joins by migration only |
| `cxbot_events` | CPI, payrolls, FOMC, ECB, BoE (from `agents/cb_releases.ts`), and dated upgrades or rulings the server accepts with a source | `event_at`, kind, source |
| `cxbot_forecasts` | Phase 0: market id, question, horizon, Grok's p, reason and sources, the market's mid and last trade at the same minute, outcome | `unique (market_id, horizon)` |
| `cxbot_decisions` | every wake's decisions, real or shadow: category (E, R, N, V, C), direction, entry, stop, limit, p, the server's m and p\*, invalidation, sources, funding at the time | GROKPM's and IGBOT's shape |
| `cxbot_cycles`, `cxbot_daily` | each wake; each UTC day's first equity; latches | |
| `cxbot_requests` | every request and every refusal by rule name | |
| `cxbot_orders`, `cxbot_positions` | orders (written BEFORE a send, settled by the sync), positions with leverage, margin mode, liquidation price, the venue's stop order id, accrued funding | `cloid` (Hyperliquid's client order id) |
| `cxbot_snapshots` | equity every 5 minutes: paper from the tape; testnet and live from the venue's `clearinghouseState`, never the agent's word | |
| `cxbot_tape` | the recorder: each minute's Hyperliquid book touch, depth and trades for the whitelist, funding hourly, Polymarket crypto mids and last trades every 5 minutes | pruned like `agent_book_levels` |
| `cxbot_exec_state` | the 20-second lease, the sync's beat | |

### 5.4 Edge Function actions (bearer `CXBOT_TOKEN`, the agent's only credential)

`ping`; `context` (budget, positions and orders with liquidation prices and stops, latches, the next events, recent
refusals); `market` (touch, depth, candles, funding, max leverage for one coin); `markets_pm` (the open Polymarket crypto
questions and prices); `forecast` (Phase 0: p for a market at a horizon; refused off-schedule or twice); `order` (a bracket:
direction, entry type and level, stop, limit, p, category, sources, invalidation); `close`; `amend` (a stop may only tighten);
`cancel`; `journal` (a `no_action` shadow bracket); `record` and `sync` (cron only); `rec` (a keyless read-only view for a
TESTING page later).

### 5.5 CXBOT_RULES (pure, in `rules.ts`, each pinned alone in `rules.test.ts`)

| rule | value | why |
|---|---|---|
| instruments | BTC, ETH, SOL perpetuals; ETH-against-BTC as two legs of equal notional | the deepest books measured (§2.3) |
| margin mode | **isolated only**: the server sets the coin's leverage with `isCross` false before every open and the sync reads every position's mode; a cross position is closed | one position's loss can never reach the rest of the account |
| leverage | **≤ 3×** per position (set on the venue, read back) | at 3× isolated the liquidation sits ~32 % from entry on BTC (33.3 % of margin less the 1.25 % maintenance; ~31 % on SOL, maintenance 2.5 %), far beyond any stop |
| stop on the venue | every open is sent with a reduce-only stop-market trigger in the same request (a position TP/SL); the sync checks each position has its resting stop and its size, re-places a missing one, and closes the position at once if it cannot | the stop holds if the server, Grok or the network is down |
| liquidation distance | the liquidation price (the venue's `liquidationPx`) at least 2.5 × the stop distance beyond the stop, or the open is refused; the sync closes a position whose liquidation price comes within 2 × | a liquidation never comes before the bot's own stop |
| bracket | stop and limit on every open; reward ≥ 1.5 × risk; stop distance 2 %–10 % (ETH/BTC legs 1.5 %–8 %) | the forecast the test scores; a capped loss |
| edge | p ≥ p\* + 0.08, p\* = (d_stop + c)/(d_stop + d_limit), c the modelled round trip plus 3 days of funding at the current rate | GROKPM's A bar, net of costs; the agent supplies neither m nor c |
| risk per trade | ≤ 1 % of the budget at the stop, costs included, and ≤ ¼ Kelly of the bot's equity | as IGBOT, GROKPM D3/D8 |
| total risk | ≤ 3 % of the budget at the stops | three trades at full risk |
| open at once | ≤ 3, one per coin: no adding, averaging down or hedging (the ETH/BTC pair is one decision, two legs) | the common way a retail book blows up |
| exposure | gross notional ≤ 1.5 × budget, net ≤ 1 × | no leverage beyond what the stops cover; margin used ≤ 50 % of equity |
| funding | no open paying more than 0.01 % an hour (8× the floor) at the moment of entry; a position paying more than that for 6 hours running is flagged to the agent | extreme funding is a cost the bracket did not price |
| hold | any position held 7 days is closed by the server | stale theses; funding |
| blackouts | no open from T−10 to T+5 minutes of a listed CPI, payrolls or FOMC release; no open while the book is wider than 5 bps or the tape older than 2 minutes | fills slip at the print; a stale or thin book |
| categories | E (an `event_at` within 72 h ahead), R (an event within 24 h behind), N (a thesis of days), V (ETH/BTC), C (changes); every open ≥ 1 source and an invalidation | GROKPM's journal discipline |
| day stop | −2 % from the day's first equity: no open until 00:00 UTC, latched | as IGBOT |
| total stop | −10 % from the start: close-only to the end, latched; the test FAILS | as IGBOT and GROKPM |
| order rate | ≤ 3 trading requests a minute and ≤ 30 a UTC day from the agent; ≤ 300 requests an hour | Hyperliquid's address budget starts at 10,000 actions |
| gates | global pause; mode; the tape fresh; equity read | the project's kill switches |

### 5.6 Paper fills by construction (Phase 1)

- A resting limit fills only on a recorded **trade through its price** (`tradedThrough`: volume > 0, strictly through;
  reference §3.26) on minutes that began after it was written (reference §4 item 41).
- A marketable order fills at the recorded touch plus the book's depth for its size. A stop triggers on the recorded mark
  (Hyperliquid triggers and liquidates on its mark price; which price a stop uses is to confirm on the testnet, §7) and fills
  at the next minute's far touch, never at its level.
- Fees at the entry tier; funding hourly at the recorded rate; the paper liquidation price is computed by Hyperliquid's own
  rule (maintenance = half the initial margin at max leverage) and pinned against the testnet's `liquidationPx`.
- The paper engine and the recorder are the server's; the agent never supplies a price, a fill or an outcome.

### 5.7 The independent recorder

`cxbot?action=record` every minute, its beat first: Hyperliquid's `l2Book` for each coin (weight 2 a call) and its recent
trades, `metaAndAssetCtxs` once a minute (mark, funding, open interest, max leverage), and the Polymarket crypto questions'
mids and last trades every 5 minutes. Outcomes of forecasts and brackets are settled from this table, never from anything the
agent reports.

### 5.8 Phase 2, live (only after Phase 1 and a new pre-registration)

- **A fresh EVM wallet of the bot's own** (Hyperliquid sub-accounts need $100,000 of volume first), funded with the
  pre-registered budget in USDC and nothing else. Davies holds its key; it never reaches the server.
- From that wallet he approves a **named API wallet** and stores only the API wallet's private key as an Edge secret. It can
  place and cancel orders and set leverage; it cannot withdraw, transfer or approve another agent. If it leaks, the loss is
  bounded by the account's funds, and a thief could still burn them by trading against himself in a thin market: hence a
  budget-only wallet, and the agent revoked and replaced (never reused) on any doubt.
- Every send is written before it is sent; a lost answer stays `unknown` until the sync settles it (go-live audit D3); money
  is proven by the venue's `clearinghouseState`, never by the ledger agreeing with itself. Nobody trades that wallet by hand.
- It joins the monitor's health readings (`monitor/health.ts`) and `ops-error`'s live kinds once it holds money.
- **If Davies picks Kraken instead**: the same server with a Kraken client (the agents' `kraken.ts` exists): shorts as
  `AddOrder` with `leverage=2` inside the 1× exposure cap, exits `reduce_only`, the stop as a conditional `close[ordertype]=stop-loss`,
  every shape rehearsed with `validate=true`; a new Kraken key, withdrawals off.

### 5.9 Signing and code reuse

Hyperliquid's actions are EIP-712 signed with secp256k1. The project already signs EIP-712 orders for Polymarket
(`_shared/polymarket_orders.ts`), so the signer is reused or extended, pinned against Hyperliquid's published examples.
Everything else is IGBOT's shape (about 2,000 lines and 640 of tests), GROKPM's Polymarket readers, `cb_releases.ts` and the
loop's `tradedThrough`. Phase 0 alone (`forecast`, `markets_pm`, `record`, settlement; three tables) is about a quarter of it.

### 5.10 The desk ledger

`CXBOT_LEDGER.md`, alone on the branch `cxbot-ledger` (no CI, no deploy, never merged), seeded from
`docs/agents/cxbot/ledger_seed.md` when built; Grok reads it every wake and answers Claude there, under 10,240 bytes, as
GROKPM's and IGBOT's.

### 5.11 The prompt, in outline (`docs/agents/cxbot/GROK_PROMPT.md` when built)

1. Who you are: an analyst whose job is calibrated probabilities first and trades second; the base rates and GROKPM's scores,
   stated, so it knows the bar.
2. The server: the actions, the bearer; it holds no key; the server enforces everything, leverage and stops included.
3. Phase 0 duties: at each scheduled horizon a p for every listed strike, with sources and a one-line reason; never copy the
   market's price.
4. The rules (§5.5), each with the refusal name it will see.
5. How to size a bracket: m, p\*, the cost table, worked examples in a JSON file the tests check (as IGBOT's `examples.json`).
6. The categories and journal fields; a shadow bracket for every candidate researched to a number.
7. The rhythm (§5.12) and the desk ledger.
8. Never: ask for a key, trade outside the server, average down, widen a stop, raise leverage, treat a stale headline as news.

### 5.12 The wake cadence

Grok has tokens to spare, but more wakes do not buy speed against bots; they buy **forecasts**.

- **Phase 0:** wakes anchored to the questions: 24 h, 8 h and 2 h before each daily resolution (16:00 UTC for the "above ___"
  family as listed today; **[audit 2026-10-29]** 17:00 UTC from 2026-11-01, when US summer time ends: the questions resolve at 12:00 ET), plus one every 4 hours for the barrier family. Each wake forecasts every open strike.
- **Phase 1:** every 30 minutes, plus T−60, T+15 and T+60 minutes of each listed release. Risk does not depend on the wake:
  stops rest on the venue (testnet, live) or in the paper engine.
- Spend tokens on research depth and shadow brackets, which give the test its power.

## 6. A pre-registration outline (DRAFT headings, nothing frozen)

1. On whose word; what is ours (server, tables, minute calls) and what is not (Grok, its schedule, the venue).
2. **H0 (Phase 0):** Grok's p on Polymarket crypto price questions is no better than the market's price at the same minute.
   **Pass:** ≥ 400 forecasts in ≥ 40 event-day clusters resolved; the cluster-bootstrap mean d < 0 with one-sided p < 0.05
   against BOTH the mid and the last trade, the log score agreeing. **Fail** otherwise: stop, no Phase 1.
3. **Phase 1:** 6 weeks of paper brackets on the mainnet tape (§5.5), a notional $1,000, with the testnet rehearsal passed
   first (every order shape, an isolated 3× position, its venue stop, a cancel, the sync's read-back); reading: Brier of p
   against m and p\* on real and shadow brackets, P&L reported, the total stop a FAIL.
4. **Phase 2:** a separate pre-registration: venue, budget (a few hundred dollars), Davies' word, the live arm.
5. Not blind (Davies, 2026-10-04): every record may be read at any time; the readings run as written.

## 7. Not settled, not checked

- **Whether Davies may use each venue**: Hyperliquid's terms do not exclude the UK; Binance's position for his account is
  his to read in the account; the UK's view of a UK resident trading offshore perpetuals is general information here, not
  advice. Tax on perpetuals' gains and funding, and on margin shorts: for an adviser.
- **Reachability from `eu-west-2`** of Hyperliquid's API and Binance's futures endpoint: not measured (this container is in
  the US). **[audit 2026-10-29]** OKX's public API is measured from our Edge (its recorder, 60 of 60 minutes); Bybit's is not; the build's first step is a keyless `reach` probe. A deployed read-only probe would be the build's first check.
- Hyperliquid: whether a stop trigger fires on the mark or the last price (the order-types page does not say; **[audit 2026-10-29]** settled: the mark, per its FAQ and "robust price indices" page); whether an
  API wallet's approval can carry an expiry; the bridge's and validators' security (from memory); the testnet faucet's
  conditions (from memory: a mainnet deposit history). The API-wallet withdrawal limit rests on third-party SDK docs and
  Hyperliquid's "only used to sign".
- Binance: futures funding interval, liquidation fee and order types (from memory); its UK terms for an existing account.
- Kraken: whether its UK margin is a regulated investment; what a UK account's margin form shows; the meaning of the public
  `margin_rate` field (inferred).
- Whether any inverse crypto ETN is admissible for UK retail; Coinbase UK derivatives' entity and API (paywalled); OKX UK's
  API (a mirror's table).
- Polymarket crypto markets' resolution sources and timing per family: to read from each market's rules before Phase 0.
- Literature marked "from memory" (unlock drift, ETF flows, LLM forecasters).
- No private call to any venue; no order of any kind.

## 8. What Davies would do (no secret in a chat or a commit)

- **Now: choose.** Phase 0 (recommended), or stop here. Name the bot. Say which venue route he prefers for later
  (Hyperliquid, Kraken, or long-only Revolut X), having read §2.2.
- **[audit 2026-10-29]** **Phase 1 needs only `CXBOT_TOKEN`**: the testnet rehearsal moves to Phase 2's preparation, so no testnet key either.
- **Phase 0 and Phase 1: one secret**, `CXBOT_TOKEN` (32+ random characters), as a Supabase Edge Function secret, given only
  to Grok. For the Phase 1 testnet rehearsal, a **testnet** API wallet's key, `CXBOT_HL_TESTNET_AGENT_KEY`, and the testnet
  account address, `CXBOT_HL_TESTNET_ACCOUNT` (play money; the agent wallet is approved from a testnet account he controls).
- **Phase 2, later, only after a pass:** a fresh wallet for the bot funded with the budget alone; from it, approve a named API
  wallet; store `CXBOT_HL_AGENT_KEY` (the API wallet's private key) and `CXBOT_HL_ACCOUNT` (the bot wallet's public address).
  **Never the bot wallet's own key, never his main wallet's.** Nobody trades that wallet by hand. (Kraken instead: a new
  key with withdrawals off as `CXBOT_KRAKEN_API_KEY` / `CXBOT_KRAKEN_PRIVATE_KEY`, never the loop's `KRAKEN_PRO_*`. Binance
  instead: only after he has confirmed his account's futures terms; a new trade-only key, withdrawals off.)
- **Elective professional:** not recommended; his application and declaration if he wants it for other reasons.

## Sources (read 2026-10-28 unless stated)

- Hyperliquid terms of use ("Last updated on June 15, 2026"), read from the page's script `assets/TermsOfUse-wBaffXrT.js` at https://app.hyperliquid.xyz/terms
- Hyperliquid docs: fees https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees ; funding https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding ;
  liquidations https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations ; order types https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types ;
  API wallets https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets ;
  rate limits https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits ;
  sub-accounts https://hyperliquid.gitbook.io/hyperliquid-docs/trading/sub-accounts
- API wallets cannot withdraw (third-party): https://docs.chainstack.com/docs/hyperliquid-authentication-guide , https://docs.privy.io/recipes/hyperliquid/policies-and-offline-actions.md
- Hyperliquid, measured: `POST https://api.hyperliquid.xyz/info` (`metaAndAssetCtxs`, `l2Book` BTC/ETH/SOL, 23:33:10 UTC); `POST https://api.hyperliquid-testnet.xyz/info` (`meta`)
- Binance futures fees FAQ (2026-04-28): https://www.binance.com/support/faq/360033544231 ; 2021 UK derivatives restriction:
  https://coindesk.com/policy/2021/12/14/binance-uk-is-threatening-to-block-derivatives-traders-in-a-move-to-keep-regulators-at-bay ;
  UK group claim (2026-07-01): https://cryptodaily.co.uk/2026/07/binance-uk-lawsuit-crypto-derivatives-perps
- Binance and others, measured from this container (23:33:54 UTC): `fapi.binance.com/fapi/v1/ping` 451, `testnet.binancefuture.com/fapi/v1/ping` 200,
  `testnet.binance.vision/api/v3/ping` 451, `api.bybit.com/v5/market/time` 403, `api-testnet.bybit.com` 403, `www.okx.com/api/v5/public/time` 200, `indexer.dydx.trade/v4/time` 200
- Bybit and the UK (secondary): https://coin360.com/news/bybit-returns-uk-fca-compliance-spot-trading , https://www.coinperps.com/learn/bybit-restricted-countries
- dYdX geo-restrictions: https://help.dydx.trade/en/articles/166970-geo-restrictions-site-access
- Kraken: UK margin (2026-10-19) https://support.kraken.com/hc/en-us/articles/margin-trading-for-clients-in-the-united-kingdom ;
  eligibility (2026-09-11) https://support.kraken.com/gb/articles/4402532394260-Client-eligibility-for-margin-trading-services- ;
  UK professional clients (2026-10-23) https://support.kraken.com/articles/futures-trading-for-clients-in-the-united-kingdom ;
  fees https://www.kraken.com/features/fee-schedule ; AddOrder https://docs.kraken.com/api/docs/rest-api/add-order ;
  subaccounts https://docs.kraken.com/exchange/guides/general/subaccounts
- Kraken, measured: `/0/public/AssetPairs`, `/0/public/Assets` (23:22:45 UTC); `futures.kraken.com/derivatives/api/v3/tickers` 200;
  `demo-futures.kraken.com/derivatives/api/v3/tickers` 301 (23:23:58 UTC)
- Deribit, measured: `test.deribit.com/api/v2/public/get_index_price`, `www.deribit.com/api/v2/public/get_funding_rate_value` (23:24 UTC)
- Polymarket Gamma, measured: `gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=bitcoin` (23:27:59 UTC)
- FCA cryptoasset regime policy statements (June 2026): https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime ; PS26/11 https://www.fca.org.uk/publication/policy/ps26-11.pdf (found; summaries read)
- CP25/36 summaries: https://www.simmons-simmons.com/en/publications/cmiyksa4z003ouj4gb3faozxl/fca-cp25-36-a-dramatic-overhaul-of-client-categorisation-rules , https://www.skadden.com/insights/publications/2026/01/fca-consults-on-reforms-to-client-categorisation
- cETNs for retail from 2025-10-08: https://www.mondaq.com/uk/commoditiesderivativesstock-exchanges/1666034/fca-opens-retail-access-to-crypto-etns
- *Payward Inc v Chechetkin* [2023] EWHC 1780 (Comm): https://caselaw.nationalarchives.gov.uk/ewhc/comm/2023/1780 ; claimant firms: https://www.fieldfisher.com/en/kraken , https://www.edwincoe.com/services/dispute-resolution/class-actions/kraken-margin-trading-services-claim/
- Kraken Australia margin case (secondary): https://www.tipranks.com/news/kraken-hit-with-5-1-million-fine-over-margin-trading
- Coinbase UK derivatives (2026-08-11): https://www.fow.com/insights/coinbase-widens-derivatives-access-to-uk-professional-clients
- IG crypto (2026-05-13): https://www.ig.com/uk/media-centre/press-release-overview/IG-expands-UK-crypto-offering-with-50-new-digital-assets-and-advanced-trading-features
- OKX UK product table (mirror): https://okx-api.aperture.finance/en-gb/help/okx-what-can-i-use-in-the-united-kingdom
- This repository: `docs/agents/venue-survey.md`; `docs/agents/reference.md` §2, §2b, §3.3–§3.45, §3.55, §6; `reviews/2026-10-01-research-round.md`;
  `reviews/2026-10-23-grokpm-rules-study.md`; `reviews/2026-10-28-grokpm-utilisation.md`; `reviews/2026-10-29-igbot-research.md`
