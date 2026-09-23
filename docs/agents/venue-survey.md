# Venue survey: where else to trade, short, broaden and get data

Researched 2026-09-22 and 2026-09-23 (UTC) for Davies. It starts from the
earlier session's cited notes and fills their gaps. Every claim about
availability, regulation, fees or API capability carries a source tag
(`[S…]`, listed at the end with the date read) or says **measured**, with
the time, when it was measured from this container. The container's egress
is in the US (Ohio). **UNVERIFIED** means no current source confirmed it.
No money amounts from Davies' accounts appear here. This is research, not
financial, legal or tax advice.

## 0. What decides fit

- **The rules.** Long-only trend following on 4-hour bars on BTC, ETH,
  SOL, AVAX and SUI, plus a 1-hour trend row and 30-day momentum in paper.
  At most a few round trips a week per coin [R4 §1–§2].
- **Fees decide everything.** On Revolut X a round trip costs about 20 bps
  on BTC/ETH/SOL and 33–42 on SUI (a 33 bps median over 60 samples,
  reference §3.20; 41.5 in this survey's quiet-hour snapshot). At Kraken's 80–100 bps the same rules
  stop paying [R3 §3.12, §4 item 23]. The working ceiling is **well under
  ~40 bps a round trip**. Nothing faster than 1-hour bars survives fees,
  and cross-venue arbitrage never covered a fee [R3 §2c, §3.6].
- **What the loop needs.** It is a Supabase Edge Function. It needs a REST
  API with signed order placement, order status by client order id,
  balances, and public candles and quotes. A venue that needs a local
  gateway process (IBKR's Client Portal Gateway, Futu's OpenD) needs a
  separate always-on host.
- **Shorting.** The rule is long-only and loses in sideways years (window
  D) [R4 §4]. A short side is only worth money if a symmetric rule clears
  the same bar (reference §4 item 15) in backtests first.
- **"Round trip" below** = two taker fills at the entry fee tier plus the
  quoted spread. Spreads are the median of five samples, **measured
  2026-09-22 23:52–23:57 UTC** (a quiet hour), unless stated. A maker
  figure assumes the resting order fills, which it may not.

## 1. Summary

### UK (where Davies lives now)

**1. Where to run the existing crypto rules: stay on Revolut X.** No other
UK venue with an API is cheaper on these five coins at an entry tier.

1. **Revolut X.** 0 % maker / 0.09 % taker. Round trip 19.7 / 20.5 / 20.7 /
   27.8 / 41.5 bps (BTC / ETH / SOL / AVAX / SUI).
2. **Bitstamp**, as the backup. UK-registered, the deepest cheap book
   (BTC/ETH/SOL spreads 0–0.1 bps), an API with client order ids and a
   sandbox. Its entry fee, 0.30 % / 0.40 % (80 bps a round trip), is too
   high, **unless** its no-fee tier below $1,000 of 30-day volume still
   exists. Bitstamp said it did in December 2022; 2026 reviews disagree
   (**UNVERIFIED**). That tier would only help while monthly volume stays
   under $1,000.
3. **Coinbase Advanced**, if the signup can be fixed. 0.25 % / 0.50 %
   since 2026-09-16: 50 bps a round trip resting, 100 taking.

Not usable for the loop: OKX (its UK service has no API), Bybit (not
FCA-registered; UK API UNVERIFIED; blocks US IPs), Binance (no new UK
users since 2023; Davies' existing account can trade spot — §11), Gemini (left the UK in 2026), Kraken (fees), CoinJar
(spreads 24–282 bps), IBKR crypto (per-order minimum), IG and Robinhood UK
(no crypto API).

**2. Shorting: none for UK retail.** The FCA's ban on crypto derivatives
for retail stays. The October 2025 change opened only physically backed,
unleveraged crypto ETNs [S2][S3]. The only legal door is being treated as
an "elective professional" client [S5], which removes retail protections.
Not recommended.

**3. Other asset classes with an API.**

1. **Trading 212** (existing account). Its API now places Market, Limit,
   Stop and Stop-Limit orders on Invest and Stocks ISA accounts [S81].
   UK/EU-listed ETFs; BTC/ETH ETNs in Invest only.
2. **IBKR UK.** The widest range (stocks, ETFs, futures, options, FX, some
   crypto). The API needs a gateway on a host.
3. **IG REST API** (spread bets: gains outside CGT, losses not deductible;
   no crypto for retail). Saxo OpenAPI and OANDA v20 are alternatives.

### US (only as a US resident with an SSN or ITIN and a US address)

**1. Existing crypto rules.**

1. **Binance.US.** 0 % / 0.02 % for every user since 2026-04-22 [S40].
   Round trip 4.0 / 4.7 / 6.5 / 13.8 / 12.8 bps. Caveats: closed in 16
   states and territories, including NY, TX, WA, NC, OH, OR, GA and CT
   [S40]; thin books (24-hour BTC/USD about $1.4M, SUI/USD about $0.09M,
   under the repo's $100k-a-day bar; measured 2026-09-22 19:55 UTC);
   whether its API answers the loop's egress is UNVERIFIED.
2. **Alpaca.** 0.15 % / 0.25 % [S45]. About 54 bps a round trip on BTC; no
   SUI (measured). Useful mainly as one account for stocks and crypto.
3. Everything else costs more than Revolut X at entry tiers: OKX US
   0.20 / 0.35 %, Kraken 0.40 / 0.80 %, Coinbase 0.50 / 0.90 %, Gemini
   0.60 / 1.20 %, Robinhood exchange routing 0.50 / 0.95 %.

**2. Shorting: legal and cheap per trade, but contracts are large.**

1. **Coinbase perp-style futures** (CFTC-regulated, 24/7, hourly funding)
   on all five coins. About 5–22 bps a round trip on BTC/ETH/SOL/SUI, plus
   funding (the range depends on how fees stack, UNVERIFIED). One contract
   is $109 (AVAX) to $863 (BTC) of notional. The overnight margin for a
   short is 31–57 % of notional (measured). Same Advanced Trade API as
   spot.
2. **Kalshi BTC perpetual.** 0.0001 BTC contracts, fees waived at launch;
   BTC only; state eligibility UNVERIFIED [S48].
3. **Kraken US perps** on Bitnomial. $0.15 per contract per side; no SUI
   [S49].

CME micros are too big: Micro Bitcoin is 0.1 BTC, with about $2,800 of
initial margin in March 2026 [S50].

**3. Other asset classes.** 1. Alpaca (API-first, free paper trading,
stocks/ETFs/crypto). 2. IBKR. 3. tastytrade or Tradier for options.
Schwab's and E*TRADE's tokens expire weekly or daily, a poor fit for an
unattended loop.

### Hong Kong (only with an HKID or HK residential-address proof)

**1. Existing crypto rules.** Only SFC-licensed platforms are legal routes
[S60]. None matches Revolut X with an API.

1. **Futu HK (PantherTrade) through Futu OpenAPI.** 0.08 % commission plus
   0.08 % platform fee per side: 32 bps a round trip plus spread [S67].
   BTC, ETH, SOL, AVAX; no SUI. OpenAPI needs the OpenD gateway on a host.
2. **HashKey Exchange.** BTC/ETH book about 0 bps wide. Retail may trade
   BTC/ETH/SOL/AVAX; SUI is professional-investor-only (measured). Fee
   0.12 % or 0.29 % per side (sources conflict) and a **USD 1.99 minimum
   per filled order** since 2025-07-30 [S65]. The API is written for
   institutions; retail API access is UNVERIFIED.
3. **Tiger (YAX).** 0.05 % per side, the cheapest [S68]. Its Open API has
   no crypto security type, so manual only.

OSL has no API for general retail [S66]. IBKR HK trades crypto via OSL at
0.20–0.30 % with a USD 2.25 minimum [S70].

**2. Shorting.** Perpetuals are for professional investors only (SFC,
February 2026) [S63]. Retail may trade crypto futures on a regulated
exchange (e.g., CME through Futu HK) after a virtual-asset knowledge test
[S62], and the HKEX-listed CSOP −1x Bitcoin futures product (7376). Large
contracts, or exchange hours only.

**3. Other asset classes.** Futu OpenAPI, Tiger Open API (with paper
trading), Longbridge OpenAPI, IBKR HK.

### Data sources to add first

1. **Binance public bulk data** (`data.binance.vision`). Keyless and
   reachable, where `api.binance.com` answers HTTP 451. It adds ~10–12
   months of SOL (from 2020-08) and AVAX (from 2020-09) before Coinbase's
   series, plus perp funding (from 2020) and open interest (from 2020-09).
2. **Deribit public API.** Keyless. DVOL implied volatility (BTC from
   2021-03-24) and perpetual funding history (back to at least
   2019-05-01). Candidate regime inputs.
3. **Bitstamp public OHLC.** Keyless, 4-hour bars, BTC from 2011-08-18: a
   third, independent USD tape for the tape-robustness checks
   (reference §3.16, §3.19).

Cheap extras: alternative.me Fear & Greed (daily since 2018), FRED
(keyless CSV), Coin Metrics Community (free, non-commercial), Coinbase's
public futures data (funding and margin for any short-side study).

### What not to do

- No VPN, and no platform that excludes Davies' residency (§3.4 lists
  them).
- Do not move live money to a venue that costs more than ~40 bps a round
  trip.
- Do not trade small tickets where there is a per-order minimum fee
  (HashKey USD 1.99; IBKR USD 1.75–2.25).
- Do not open a derivatives account before a symmetric rule clears the
  bar of reference §4 item 15 on all four windows.
- Do not build on an API that geo-blocks by caller IP (Bybit,
  Binance.com). The loop's egress is not in Davies' country.
- Do not count on compensation for crypto. The FSCS does not cover it
  [S2][S20], SIPC does not cover it [S103], and HK's Investor
  Compensation Fund is for exchange-traded securities and futures [S103].
- Do not chase cross-venue arbitrage (reference §2c).

## 2. Cost against Revolut X

Round trip in bps = 2 × entry taker fee + quoted spread (median of five
samples, measured 2026-09-22 23:52–23:57 UTC).

| Venue | Route | Entry maker / taker | BTC | ETH | SOL | AVAX | SUI | Note |
|---|---|---|---|---|---|---|---|---|
| Revolut X | UK | 0 / 0.09 % | 19.7 | 20.5 | 20.7 | 27.8 | 41.5 | baseline [R3 §2] |
| Binance.US | US | 0 / 0.02 % | 4.0 | 4.7 | 6.5 | 13.8 | 12.8 | thin book [S40] |
| Bitstamp | UK (US table UNVERIFIED) | 0.30 / 0.40 % | 80.0 | 80.0 | 80.1 | 81.6 | 84.4 | 0 % below $1k/30 days: UNVERIFIED for 2026 [S19] |
| Coinbase Advanced | UK | 0.25 / 0.50 % | 100.0 | 100.0 | 101.7 | 100.9 | 101.0 | resting: 50 [S14] |
| Crypto.com Exchange | UK | 0.25 / 0.50 % | 100.0 | 100.0 | 100.8 | 104.4 | 102.4 | fee from reviews [S21] |
| Kraken Pro | UK, US | 0.40 / 0.80 % | 160.0 | 160.0 | 160.8 | 162.7 | 163.9 | resting: 80 [R3 §2b] |
| Coinbase Advanced | US | 0.50 / 0.90 % | 180.0 | 180.0 | 181.7 | 180.9 | 181.0 | resting: 100 [S14] |
| Gemini | US | 0.60 / 1.20 % | 240.0 | 240.0 | 240.1 | 248.0 | 327.5 | [S42] |
| OKX US | US | 0.20 / 0.35 % | 70 + spread | | | | | US book not measured [S43] |
| Alpaca | US | 0.15 / 0.25 % | 54.2 | 53.9 | 62.7 | 113.8 | not listed | spreads measured 2026-09-23 00:04 UTC [S45] |
| CoinJar Exchange (USDC pairs) | UK | 0 / 0.06 % | 36.4 | 44.7 | 79.4 | 293.9 | 292.6 | [S27] |
| HashKey Exchange | HK | 0.12 or 0.29 % | 24–58 | 24–58 | 27–61 | 31–65 | PI only | plus USD 1.99 minimum per filled order [S65] |
| Futu HK / PantherTrade | HK | 0.16 % all-in | 32 + spread | | | | not listed | book not measured [S67] |
| Tiger / YAX | HK | 0.05 % | 10 + spread | | | | not listed | no crypto API [S68] |
| IBKR crypto | UK, US | 0.18 %, min USD 1.75 | 36 + spread on orders above ~$1k | | | | | [S30][S54] |
| eToro | UK | 1 % | 200 + spread | | | | | [S24] |

**What a per-order minimum does.** USD 1.99 is 199 bps on a $100 order, 20
bps on $1,000, and stops binding (at 0.12 %) only above about $1,660.
IBKR's USD 1.75 binds below about $970 at 0.18 %.

**The spread ranking is stable across the day.** Two measurements, bps:

| Venue | 2026-09-22 20:07 UTC (one instant) | 23:52–23:57 UTC (median of five) |
|---|---|---|
| Revolut X (UK book) | 4.2 / 2.1 / 3.2 / 8.2 / 23.9 | 1.7 / 2.5 / 2.7 / 9.8 / 23.5 |
| Kraken | 0.01 / 0.04 / 1.7 / 0.9 / 1.0 | 0.01 / 0.04 / 0.8 / 2.7 / 3.9 |
| Coinbase | 0.0 / 0.15 / 0.9 / 1.8 / 1.0 | 0.0 / 0.04 / 1.7 / 0.9 / 1.0 |
| Bitstamp | 0.0 / 0.04 / 0.08 / 6.5 / 4.3 | 0.0 / 0.04 / 0.08 / 1.6 / 4.4 |
| OKX (USDT) | 0.01 / 0.04 / 0.9 / 1.8 / 2.0 | 0.01 / 0.04 / 0.8 / 1.8 / 1.0 |
| Binance.US | 0.0 / 0.9 / 2.5 / 9.1 / 5.0 (19:55) | 0.03 / 0.7 / 2.5 / 9.8 / 8.8 |
| Crypto.com | — | 0.0 / 0.04 / 0.8 / 4.4 / 2.4 |
| Gemini | — | 0.0 / 0.04 / 0.08 / 8.0 / 87.5 |
| HashKey | — | 0.0 / 0.04 / 2.5 / 7.1 / 2.0 |
| CoinJar (USDC) | — | 24.4 / 32.7 / 67.4 / 281.9 / 280.6 |

**24-hour volume** (quote currency, measured the same day): Coinbase $807M
/ $336M / $131M / $25M / $42M; OKX $591M / $384M / $135M / $13M / $46M;
Kraken $304M / $115M / $63M / $12.5M / $21M; Bitstamp $230M / $34M / $32M /
$3.1M / $3.0M (all 20:07 UTC); HashKey $24.0M / $16.4M / $2.7M / $0.33M /
$0.01M (23:45 UTC); Binance.US USD pairs $1.40M / $1.60M / $0.62M / $0.24M
/ $0.09M (19:55 UTC); CoinJar BTC-USDC about $0.38M (23:52 UTC).

## 3. Crypto exchanges, per route

### 3.1 UK route

Every UK venue must run the FCA's financial-promotion journey for new
retail customers: risk warnings, client categorisation, an
appropriateness test and a 24-hour cooling-off period for first-time
investors [S1]. The FCA's full crypto regime is coming: its authorisation
gateway opens on 2026-09-30 and the regime starts on 2027-10-25 [S4]. A
venue without authorisation must stop then, so this list will change in
2027, and Revolut X will need that authorisation too.

| Platform | UK status | API | Fees (entry, ladder) | Five coins | Verdict |
|---|---|---|---|---|---|
| **Revolut X** | Revolut Ltd on the FCA cryptoasset register since 2022-09-26 (secondary); UK and EEA only [S31] | REST; Ed25519 keys; `client_order_id` (UUID); 1,000 orders a day; public candles, one year of 4 h; no sandbox [R3 §2] | 0 / 0.09 %, no tiers [R3 §2] | all five [R3 §2.1] | **Keep** |
| **Bitstamp** (by Robinhood) | Bitstamp UK Ltd, FCA-registered cryptoasset firm, FRN 978690 [S20] | REST, WebSocket, FIX; HMAC-SHA256 `X-Auth` headers; `client_order_id` up to 180 chars, queryable; 400 req/s and 10,000 per 10 min; OHLC incl. 4 h, 1,000 bars a call; sandbox [S19] | 0.30 / 0.40 % below $10k of 30-day volume, falling to 0 / 0.03 % above $1bn [S19, reviews]; 0 % below $1k per Bitstamp's blog of 2022-12-15, 2026 status UNVERIFIED | BTC, ETH, SOL, AVAX, SUI vs USD; BTC and ETH also vs GBP; $10 minimum order (measured 2026-09-23 00:04 UTC) | **Backup** |
| **Coinbase Advanced** | CB Payments Ltd: FCA e-money institution and MLR cryptoasset registration, FRN 900635 [S15]. The FCA fined it £3.5m on 2024-07-25 for onboarding 13,416 high-risk customers while barred from doing so [S7] | REST, WebSocket; CDP keys, JWT signed with ES256 (Ed25519 is not supported for these keys); `client_order_id` required and queryable; `/orders/preview` dry run; mocked sandbox; 30 req/s private, 10 req/s public [S16] | 0.25 / 0.50 % from 2026-09-16; tiers from $10k (was $25k); VIP programme not offered in the UK [S14] | all five (measured) | **Backup**, if signup works |
| Crypto.com Exchange | Foris DAX UK Ltd, FCA-registered (reviews) [S21] | REST, WebSocket, FIX; HMAC-SHA256; `client_oid`; create-order 14 per 100 ms [S21] | 0.25 / 0.50 % below $10k (reviews) [S21]; CRO-staking discounts | all five (measured) | No: fees |
| Kraken Pro | Payward Ltd, FRN 928768 [S28] | see [R3 §2b] | 0.40 / 0.80 % [R3 §2b] | all five | Data only [R3 §4 item 23] |
| OKX | UK users served by Aux Cayes FinTech Co. Ltd (Seychelles). Spot order book and Convert only; **API, GBP deposits, trading bots, demo trading and all derivatives are unavailable in the UK** [S10]. Categorisation, appropriateness test and cooling-off apply [S11]. Not FCA-registered (reviews) | none for UK users | — | — | **Unusable** (its public data is still fine) |
| Bybit | Spot (100 pairs) and P2P since 2025-12-19, under promotions approved by Archax. Bybit says it is "not authorised, regulated, or registered by the FCA" [S12] | V5 API exists; UK access UNVERIFIED; `api.bybit.com` answers 403 to a US IP (measured 2026-09-22 23:49 UTC) | 0.10 / 0.10 % base spot (Bybit help, via search) [S12]; fiat pairs 0.15 / 0.20 % (review) | UNVERIFIED | No |
| Binance | No new UK users since 2023-10-16; existing users keep spot [S104]. Relaunch aimed at 2027, subject to the FCA [S13] | REST; refuses US addresses (§11) | 0.10 / 0.10 %, 0.075 % with BNB | all five vs USDT | Davies' existing account: see §11 |
| Gemini | Left the UK: withdrawal-only from 2026-03-05, accounts closed from 2026-04-06 [S6] | — | — | — | Unavailable |
| Bitfinex | No new UK individuals since 2023-11-01 except high-net-worth or sophisticated; existing UK users restricted from 2024-01-10 [S23] | — | — | — | Unavailable to retail |
| Bitpanda | UK relaunch in August 2025 with FCA registration [S22] | Fusion REST API: market, limit and stop orders, up to 1,000 req/min, WebSocket "coming soon" [S22]; Fusion for UK users UNVERIFIED | Fusion 0.25 % at L1 down to 0.02 % at L7 [S22]; broker app premium about 1.49 % (review) | UNVERIFIED | No: 50 bps a round trip |
| eToro | Public API since October 2025, first to selected users [S24] | key-pair headers; real and demo order endpoints [S24] | 1 % per side on crypto (fee page, via review) [S24] | — | No: 200 bps |
| CEX.IO | CEX.IO Markets UK Ltd, MLR-registered 2026-03-12, FRN 1007192 [S25] | "Trading API" (not researched) | 0.25 / 0.25 % (review) [S25] | all five (measured, earlier session) | No: fees |
| CoinJar | CoinJar UK Ltd, FRN 928767 [S27] | exchange API (public data measured; private API not researched) | GBP pairs 0.10 / 0.10 % below £50k; crypto↔stablecoin 0 / 0.06 %; stablecoin↔fiat 0 / 0.001 % [S27] | all five vs USDC, USD and GBP (measured) | No: spreads 24–282 bps; BTC-USDC trades about $0.38M a day |
| Uphold | Uphold Europe Ltd on the FCA register since February 2022 (review) | not researched | spread 1.40–2.95 % (review) | — | No |
| Luno | The UK is not among Luno's supported markets (Kenya, Nigeria, South Africa, Indonesia, Malaysia) [S26]. Exact UK account status UNVERIFIED | — | — | — | Unavailable |
| LMAX Digital, Archax | Institutional and professional clients only (reviews; Archax FRN 838656) | — | — | — | Unavailable to retail |
| IG (spot crypto) | Via Uphold. BTC/ETH/SOL at 0 % commission plus a 0.07 % Uphold fee per trade from June 2026 [S29] | no spot-crypto API found (UNVERIFIED) | as left | BTC, ETH, SOL | No: no API |
| Robinhood UK | Crypto via Bitstamp UK; appropriateness test, 24-hour cooling-off, yearly re-certification; not FSCS-protected; "zero trading fees" (spread-based; markup UNVERIFIED) [S20] | none in the UK (the Crypto Trading API is US-only [S44]) | spread | SOL, AVAX, SUI among 60+ [S20] | No: no API |
| IBKR UK (crypto) | Via Paxos; BTC, ETH, LTC and BCH at launch [S30] | TWS API or Web API through a gateway | 0.12–0.18 % with USD 1.75 minimum per order [S30] | BTC, ETH only of the five (at launch) | No at small tickets |

### 3.2 US route

| Platform | US status and requirements | API | Fees (entry, ladder) | Five coins | Verdict |
|---|---|---|---|---|---|
| **Binance.US** | US residents only; SSN or ITIN and US documents [S40]. Not in AK, AS, CT, GA, GU, ME, MP, NY, NC, ND, OH, OR, TX, VI, VT, WA; KS and WI crypto-only [S40]. The SEC dropped its case on 2025-05-29 (news) | REST, WebSocket; HMAC-SHA256; 6,000 request weight a minute; test-order endpoint; `newClientOrderId` / `origClientOrderId`; klines incl. 4 h, 1,000 a call [S40] | 0 / 0.02 % on all pairs for all users, from 2026-04-22 [S40] | all five vs USD (measured) | **Best US fit**, if eligible |
| Alpaca | US residents; also non-US residents for brokerage (UK with UTR or NINO; HK) [S45]. Crypto for non-US residents UNVERIFIED | REST, WebSocket; key pair; free paper trading | 0.15 / 0.25 % below $100k a month, down to 0 / 0.10 % [S45] | BTC, ETH, SOL, AVAX; no SUI (measured) | Backup and broker |
| Coinbase | SSN required (help, via search) [S18] | as UK | 0.50 / 0.90 % entry [S14] | all five | No: fees (data yes) |
| Kraken | Not in NY or ME (page dated 2026-03-30) [S41]. Full SSN or ITIN at Intermediate and Pro [S41] | as UK | 0.40 / 0.80 % (one table for all regions) [S28] | all five | No: fees |
| OKX US | Live US exchange | API through us.okx.com [S43] | 0.20 / 0.35 % entry in every fee group, from 2026-02-01 [S43] | BTC, ETH, SOL, SUI in Group 1; AVAX not listed there [S43] | No: 70 bps plus spread |
| Gemini | — | REST, WebSocket; the fee schedule applies to API orders [S42] | 0.60 / 1.20 % below $10k; 0.40 / 0.80 at $10k; 0.25 / 0.50 at $25k [S42] | all five (measured) | No |
| Robinhood Crypto | US only; Crypto Trading API with Ed25519 keys; v2 adds fee tiers [S44] | — | Market-maker routing: no commission (spread; markup UNVERIFIED). Exchange routing: 0.50 / 0.95 % below $10k, down to 0 / 0.03 % above $25M [S44] | — | No |
| Crypto.com Exchange (US) | Launched 2025-01-21 for "U.S. institutional and advanced traders"; retail uses the App [S21] | REST, WebSocket, FIX | maker "as low as 0 %"; schedule UNVERIFIED | — | UNVERIFIED |
| IBKR | Via Paxos or Zero Hash | TWS or Web API through a gateway | 0.12–0.18 %, USD 1.75 minimum (search summary) [S54] | incl. SOL; AVAX and SUI UNVERIFIED | No at small tickets |
| tastytrade | — | Open API [S52] | 1 % per side, capped at $10 an order [S52] | UNVERIFIED | No |
| Schwab | All states except NY and LA; BTC and ETH only; 0.75 % a trade; no API mentioned (press release 2026-04-16) [S51] | — | — | BTC, ETH | No |

### 3.3 Hong Kong route

Only the 13 SFC-licensed platforms are legal routes [S60]. Retail may only
trade "large-cap" tokens: those in at least two acceptable indices from at
least two index providers [S64]. Retail clients also face a knowledge
assessment. Perpetuals are professional-only [S63]. The SFC requires each
licensed platform to keep its own compensation arrangement covering 50 %
of clients' crypto in cold storage and 100 % of the rest [S72]. The
Investor Compensation Fund is for exchange-traded securities and futures
[S103]; whether it ever reaches crypto held at a platform is UNVERIFIED.

| Platform (operator, licensed since) | Retail? [S61] | API for retail | Fees | Retail coins | Verdict |
|---|---|---|---|---|---|
| **PantherTrade** (Futu, 2025-01-27), via Futu HK | yes | Futu OpenAPI trades crypto for Futu HK accounts; needs the OpenD gateway; no paper trading for crypto [S67] | 0.08 % commission (below $500k a month) plus 0.08 % platform fee; no custody fee [S67] | BTC, ETH, SOL; AVAX listed 2026-05-16 [S67]; no SUI | **Best HK fit** |
| **HashKey Exchange** (Hash Blockchain, 2022-11-09) | yes | REST, WebSocket; HMAC-SHA256, `X-HK-APIKEY`; `clientOrderId` query and cancel; test-order endpoint; "tailored to institutional-grade clients" [S65]. Retail access UNVERIFIED | 0.12 % or 0.29 % per side (sources conflict); USD 1.99 minimum per filled order since 2025-07-30 [S65] | BTC, ETH, SOL, AVAX, LINK vs USD; BTC, ETH vs HKD; **SUI is PI-only** (measured `retailAllowed`, 2026-09-22 23:44 UTC); $10 minimum notional | Only at large tickets |
| YAX (Tiger, 2025-01-27), via Tiger | yes | none: the Open API's security types are STK, OPT, WAR, IOPT, CASH, FUT, FOP, FUND [S68] | 0.05 % handling fee; no commission or platform fee [S68] | BTC, ETH, SOL, AVAX, LINK [S68] | Manual only |
| OSL Exchange (OSL Digital Securities, 2020-12-15) | yes | "General retail users are not eligible for API functionality" [S66] | VIP 0 / 0.05 % from USD 10k of assets (OSL article 2026-04-03) [S66] | UNVERIFIED | No API |
| HKVAX (2024-10-03), HKbitEX (2024-12-18), EX.IO (2024-12-18), Bixin.com (2026-05-18) | yes | not researched | not researched | not researched | Unresearched |
| Accumulus (2024-12-18), DFX Labs (2024-12-18), Bullish HK (2025-02-18) | not specified | — | — | — | — |
| BGE (2025-06-17) / VDX (2026-02-13) | limited / business-to-business | — | — | — | — |
| IBKR HK (broker, crypto via OSL) | yes | TWS or Web API through a gateway | 0.20–0.30 % of value, USD 2.25 minimum per order [S70] | BTC, ETH | No at small tickets |

Not legal routes for an HK resident: Coinbase, Binance and Kraken are not
licensed in HK [S71]. OKX and Bybit withdrew their applications and
stopped serving HK in 2024 [S71]. Crypto.com is not on the list [S60].

**Mainland China.** None of these platforms is open only to mainland
residents; the reverse applies. HashKey onboards a mainland Chinese
citizen only if he lives outside the mainland: an HKID with HK
residential-address proof and an HK bank account, or overseas residence
documents (support pages, via search) [S65]. Futu and Tiger stopped
taking new mainland clients; the CSRC fined both on 2026-05-22 and
ordered a two-year sell-only wind-down for mainland clients (news) [S73].

### 3.4 Who accepts which residency

"No" means the platform does not serve that residency or has no licence
for it. Using it anyway would need a VPN or a false address. Do not.

| Platform | UK resident | US resident | HK resident |
|---|---|---|---|
| Revolut X | yes | no [S31] | no (UK and EEA only) [S31] |
| Kraken | yes | yes, except NY and ME; SSN or ITIN [S41] | no licence [S71] |
| Coinbase | yes, via the FCA journey [S1] | yes; SSN [S18] | no licence [S71] |
| Bitstamp | yes | yes, via Bitstamp USA (HI and NV excluded in its 2022 disclosure [S19]; current list UNVERIFIED) | no licence [S60] |
| Binance / Binance.US | no [S13] | Binance.US only; SSN or ITIN; 16 states and territories excluded [S40] | no licence [S71] |
| OKX | spot app only, **no API** [S10] | OKX US [S43] | no, left in 2024 [S71] |
| Bybit | spot and P2P; not FCA-registered [S12] | no: blocks US IPs (measured) | no, left in 2024 [S71] |
| Gemini | no, left in 2026 [S6] | yes [S42] | no licence [S60] |
| Crypto.com | yes [S21] | Exchange for institutional and advanced traders; App for retail [S21] | not on the SFC list [S60] |
| CoinJar, CEX.IO, Bitpanda | yes [S27][S25][S22] | UNVERIFIED | UNVERIFIED |
| Robinhood | app via Bitstamp UK, no API [S20] | yes, with API [S44] | no |
| Alpaca | brokerage yes (UTR or NINO) [S45]; crypto UNVERIFIED | yes | brokerage yes [S45]; crypto UNVERIFIED |
| IBKR | IBKR UK entity | IB LLC | IBKR HK (crypto via OSL) [S70] |
| HashKey Exchange | UNVERIFIED: its online opening accepts UK bank accounts, retail status for non-residents unclear [S65] | UNVERIFIED (US bank accounts listed) [S65] | yes; HK residential-address proof [S65] |
| OSL, PantherTrade (Futu HK), YAX (Tiger HK) | not researched | not researched | yes [S61] |
| moomoo | no (review) [S53] | moomoo US (crypto in OpenAPI) [S67] | Futu HK |

## 4. Shorting: derivatives per route

| Route | Instrument | Legal for retail? | Coins | Size | Cost per round trip | Carry | Margin | API |
|---|---|---|---|---|---|---|---|---|
| UK | Crypto futures, options, CFDs, spread bets | **No.** Banned for retail since 2021-01-06 [S3]; the ban stayed when ETNs opened in October 2025 [S2] | — | — | — | — | — | — |
| UK | Crypto ETNs | Long-only; physically backed and unleveraged; BTC and ETH [S2][S81]. No inverse ETNs | — | — | — | — | — | — |
| UK | Elective professional status | Legal if two of three tests are met: ten significant trades a quarter for four quarters, a portfolio over €500k, a year of relevant professional work (COBS 3.5.3R) [S5]. The FCA proposed dropping the quantitative test in CP25/36 [S5]. Removes retail protections | — | — | — | — | — | — |
| US | **Coinbase perp-style futures** (Coinbase Financial Markets FCM, Coinbase Derivatives DCM) | **Yes** [S46] | all five, among 118 futures products (measured) | BIP 0.01 BTC ≈ $863; ETP 0.1 ETH ≈ $275; SLP 5 SOL ≈ $590; AVP 10 AVAX ≈ $109; SUP 500 SUI ≈ $502 (measured 2026-09-22) | 0.02 % taker with a $0.15 per-contract minimum (review) [S46]; exchange fee $0.10 per contract per side [S46]. Spreads 1.2 / 3.6 / 2.5 / 17.8 / 5.9 bps (measured 23:47 UTC). About 5 / 15 / 8 / 45 / 12 bps a round trip if the exchange fee sits inside the minimum; about 8 / 22 / 11 / 64 / 16 if it is charged on top (which applies is UNVERIFIED) | Hourly funding. Measured rates 0.0016–0.0023 % an hour, about 4–6 bps a day, paid by longs to shorts at that moment | Overnight: long 25–39 %, short 31–57 % of notional (measured) | Advanced Trade API, as spot [S16] |
| US | Kalshi BTC perpetual (BTCPERP) | Yes: approved 2026-05-29, live 2026-06-03 [S47][S48] | BTC | 0.0001 BTC (≈ $8.6) [S48] | Zero fees during a launch promotion with no published end [S48] | Funding three times a day, capped at ±2 % per 8 hours [S48] | isolated in the app, portfolio via API [S48] | REST, WebSocket, FIX [S48] |
| US | Kraken US perps (Bitnomial; NinjaTrader Clearing as FCM) | Yes [S49] | BTC, ETH, SOL, XRP, ADA, LINK, DOGE, LTC, AVAX; no SUI [S49] | UNVERIFIED | $0.15 per contract per side, all-in [S49] | Settled daily at 3 pm CT [S49] | UNVERIFIED | UNVERIFIED |
| US | CME micro futures through a futures broker | Yes | BTC, ETH, SOL; AVAX and SUI since 2026-05-06; 24/7 since 2026-05-29 [S50] | Micro BTC 0.1 BTC; about $2,800 initial margin (March 2026) [S50] | about $1.2 per contract in exchange, clearing and NFA fees plus commission (review) | monthly roll and basis | exchange margin | broker APIs |
| US | Deribit perpetuals through Coinbase Financial Markets | CFTC no-action letter of 2026-05-29 treats them as foreign futures [S47]; retail availability UNVERIFIED | — | — | — | — | — | — |
| US | Inverse ETFs (e.g., ProShares BITI, −1x BTC) | Yes | BTC | shares | about 1 % a year (issuer, via search) | daily reset | cash account | any broker API; US market hours only |
| HK | Perpetuals on licensed platforms | **Professional investors only** (SFC circular of 2026-02-11) [S63] | — | — | — | — | — | — |
| HK | Crypto futures on a regulated exchange (CME) through a licensed broker | Yes, after a virtual-asset knowledge test and the derivative-product rules [S62] | Futu HK lists CME BTC/MBT, ETH/MET, SOL/MSL, XRP/MXP [S67] | Micro BTC 0.1 BTC | Futu HK example for full-size BTC: $40 commission + $1 platform + $7.50 exchange per contract [S67] | roll | exchange margin | Futu OpenAPI (futures) |
| HK | CSOP Bitcoin Futures Daily (−1x) Inverse Product (7376) | Yes | BTC | lot of 100 units | 1.99 % management fee [S83] | daily reset | — | HKEX hours only |

**Is a symmetric long/short trend rule practical?**

- **Legally:** yes in the US, barely in HK (large CME contracts, or an
  HKEX product that trades in exchange hours), no in the UK.
- **Per trade:** yes on Coinbase's perp-style futures: about 5–15 bps a
  round trip on BTC, ETH, SOL and SUI, or 8–22 if the exchange fee is
  charged on top of the commission. Mostly cheaper than Revolut X spot.
  AVAX costs 45–64 bps because of its 10-coin contract and wide book.
- **Carry:** funding changes sign. At the rates measured, a 3-day short
  would have earned about 12–17 bps and a 3-day long paid it. This was
  one instant, not an average.
- **Capital:** one contract per coin is $109–$863 of notional. With the
  measured overnight short margin, one contract of each of the five needs
  roughly $1,000 of margin, plus a buffer against liquidation. That is far
  above the live row's slot size.
- **Evidence:** none yet. The long rule's worst year is the sideways one
  (window D). A mirrored short leg whipsaws in the same regime, so the
  combined rule may do worse there. Run the symmetric version through
  `backtest.ts` on all four windows, with funding history as carry
  (Coinbase's or Binance's), before opening any derivatives account.

## 5. Brokers with an API (other asset classes)

### 5.1 UK route

| Broker | Instruments | API | Costs (headline) | Protection | Fit |
|---|---|---|---|---|---|
| **Trading 212** (existing) | UK/EU/US shares, UCITS ETFs; BTC/ETH ETNs in Invest only, after a Restricted-Investor declaration and a short test; no new ETN buys in a Stocks & Shares ISA since 2026-04-06 [S81] | REST v0, beta; Invest and Stocks ISA only (not SIPP); live Market, Limit, Stop and Stop-Limit orders; key and secret with Basic auth; demo environment; orders only in the account's main currency [S81] | 0 commission; 0.15 % FX fee (help centre, via search) | FSCS, £85k of investments per firm [S103] | **First step**: an ETF trend rule on daily bars, in the account the repo already reads |
| IBKR UK | stocks, ETFs (UCITS for retail), futures, options, FX, crypto via Paxos | TWS API or Web API; individuals run the Client Portal Gateway (Java) or TWS/IB Gateway [S54] | tiered; crypto 0.12–0.18 %, USD 1.75 minimum [S30] | FSCS for the UK entity (which entity holds assets UNVERIFIED) | Broadest; needs a host |
| Saxo | multi-asset | OpenAPI; retail may build apps for personal use; 24-hour developer token; live keys usually within minutes (developer.saxo, earlier session) | UNVERIFIED | FSCS (UK entity) | Possible |
| IG | CFDs and spread bets on indices, FX and shares (incl. crypto-related shares); no crypto derivatives for retail; spot crypto via Uphold, without API [S29] | REST and streaming. Limits: 60 non-trading req/min per app, 100 trading req/min per account, 10,000 historical price points a week (IG Labs, via search) [S29] | spread | FSCS | Spread bets: gains outside CGT and stamp duty; losses not deductible |
| OANDA (UK) | FX, CFDs, spread bets | v20 REST with a personal access token; UK clients can hold v20 and v20 spread-betting sub-accounts (review) [S52] | spread-only pricing in the UK (review) | FSCS (UNVERIFIED) | FX and index trend rules |
| Capital.com | CFDs; "Crypto Derivatives are not available to Retail clients" of its UK entity | public REST and WebSocket (≤ 40 instruments a stream) (earlier session) | spread | FSCS (UNVERIFIED) | Possible |
| CMC Markets | CFDs, spread bets; Spectre (unleveraged spread bets) for retail since 2026-05-18 (news) | no retail REST API found; FIX and API for institutions via CMC Connect | — | — | No API |
| tastytrade | US stocks, options, futures | Open API, included [S52] | options $1 a contract to open (capped $10 a leg), $0 to close [S52] | UK clients are onboarded by the US entity, which is not FCA-authorised (review) [S52]; SIPC, not FSCS | Options, if wanted |
| Webull UK | US market | OpenAPI at developer.webull-uk.com; apply for access [S53] | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Robinhood UK | US shares; CME futures (index, energy, metals, FX) at $0.75 a contract plus fees (2025-10-27) | no API mentioned | — | — | No API |
| moomoo | — | — | does not accept UK clients (review) [S53] | — | Unavailable |
| Freetrade, Hargreaves Lansdown, AJ Bell | — | no public trading API found (absence of evidence) | — | — | No |
| Lightyear | — | built on Alpaca's Broker API; no public API of its own found (UNVERIFIED) | — | — | No |
| DEGIRO | — | "no official API" (DEGIRO help) | — | — | No |

### 5.2 US route

| Broker | Instruments | API | Costs (headline) | Protection | Fit |
|---|---|---|---|---|---|
| **Alpaca** | US stocks and ETFs, options, crypto | API-first; key pair; free paper trading; free IEX market data at 200 req/min (docs, via search) | stocks commission-free (review); crypto 0.15 / 0.25 % [S45] | SIPC for securities; crypto not covered [S103] | Best API fit for ETFs and crypto in one account |
| IBKR | everything | TWS or Web API through a gateway | Pro commissions; crypto 0.12–0.18 % | SIPC [S103] | Broadest; needs a host |
| Tradier | stocks, options; no crypto | REST, bearer token | $0 stocks; $0.35 a contract for options; $50 inactivity fee below $2k and two trades a year (review) | SIPC | Options |
| tastytrade | stocks, options, futures, crypto | Open API | see §5.1; crypto 1 % capped at $10 [S52] | SIPC | Options and futures |
| Webull | stocks, options, futures, crypto, event contracts | OpenAPI for eligible retail, on application [S53] | UNVERIFIED | SIPC | Possible |
| Schwab | stocks, ETFs, options, futures; crypto (BTC, ETH) without API [S51] | Trader API; the refresh token expires every 7 days, so a weekly login | — | SIPC | Awkward for a loop |
| E*TRADE | stocks, ETFs, options; BTC, ETH, SOL (rollout 2026, review) | OAuth 1; the token expires at midnight ET and after 2 hours idle [S51] | UNVERIFIED | SIPC | Awkward for a loop |

### 5.3 Hong Kong route

| Broker | Instruments | API | Costs | Protection | Fit |
|---|---|---|---|---|---|
| **Futu HK** (moomoo) | HK, US and A-share (Connect) stocks, options, futures; crypto | OpenAPI through OpenD, a TCP gateway (default 127.0.0.1:11111) on a host; no extra API fee; crypto needs a permission [S67] | crypto 0.16 % per side [S67]; equities not researched | Investor Compensation Fund, up to HK$500k per investor per default [S103] | Best HK API; needs a host |
| Tiger (HK) | US, HK and SG stocks and ETFs, options, futures, warrants, CBBCs | Open API with Java/Python/C++/C#/TypeScript/Go/Rust SDKs; paper account; separate market-data subscription; no crypto [S68] | not researched | ICF | Good for equities |
| Longbridge | HK and US stocks and ETFs, HK warrants, US options; short selling of US stocks; no crypto [S69] | OpenAPI; no extra API fee [S69] | not researched | ICF | Equities |
| IBKR HK | everything; crypto via OSL | through a gateway | crypto 0.20–0.30 %, USD 2.25 minimum [S70] | ICF (UNVERIFIED) | Broadest |

## 6. Crypto ETFs and ETNs

| Route | What can be bought | Cost |
|---|---|---|
| UK retail | BTC and ETH crypto ETNs on the LSE since 2025-10-08: physically backed, traded on a UK recognised exchange, no FSCS [S2]. Examples: iShares Bitcoin ETP (IB1T), 21Shares, WisdomTree, Bitwise, CoinShares, Invesco [S80]. Trading 212 lists only BTC and ETH ETNs (review) [S81]; SOL, AVAX or SUI ETNs for UK retail not found (UNVERIFIED). Stocks & Shares ISA: no new crypto-ETN buys from 2026-04-06; earlier holdings may stay; an Innovative Finance ISA can hold them [S81] | IB1T TER 0.15 % to 2026-12-31, then 0.25 % (issuer, via search); issuers' range 0–0.35 % a year (search summary) |
| UK retail | US-domiciled spot ETFs (IBIT and others): **not available** [S80]. The UK's CCI regime replaced PRIIPs on 2026-04-06; old KIDs are grandfathered to 2027-06-08 [S82] | — |
| US | Spot BTC and ETH ETFs (IBIT, ETHA); SOL (BSOL, FSOL, VSOL); AVAX (VanEck VAVX); SUI (Canary SUIS, Grayscale GSUI) [S83] | IBIT and ETHA 0.25 %; BSOL 0.20 %, FSOL 0.25 %, VSOL 0.30 %; VAVX 0.20 %; GSUI 0.35 % (secondary) [S83] |
| HK retail | HK spot BTC/ETH ETFs: Bosera HashKey 3008 / 3009, ChinaAMC 3042 / 3046, Harvest 3439 / 3179; ChinaAMC Solana ETF (listed 2025-10-27); CSOP −1x Bitcoin futures product 7376 [S83] | management fee 0.30–0.99 % at launch; Solana ETF about 1.99 % (estimate); 7376 1.99 % [S83] |
| HK retail | US spot ETFs: an overseas non-derivative VA ETF is "very likely" a complex product, so **professional investors only** [S62] | — |

**Against holding coins on Revolut X.** A fee of 0.15–0.25 % a year is
0.4–0.7 bps a day held, small at the rule's 0.6–3.4-day holds
[R3 §3.12]. The problems are elsewhere. ETNs and ETFs trade only in
exchange hours (the LSE is open 08:00–16:30 UK time on weekdays), so a
4-hour rule on a 24/7 market cannot act on its own bars. Their spreads
and FX fees are UNVERIFIED. UK retail cannot buy AVAX or SUI in this form.
The fit is narrow: the 30-day momentum rule on BTC/ETH, on daily closes,
in a Trading 212 Invest account through its API.

## 7. Data APIs

Reachability was measured from this container (US egress) on 2026-09-22
and 2026-09-23. The Edge Function's egress may differ; probe from there
before depending on anything new.

| Source | What | Cost | History | Limits | Reachable | One use here |
|---|---|---|---|---|---|---|
| Coinbase Exchange public | OHLCV, 1 m to 1 d | free, no key | first daily bar BTC 2015-07-20, ETH 2016-05-18, SOL 2021-06-17, AVAX 2021-09-30, SUI 2023-05-18 (measured) | 300 candles a call; 10 req/s per IP, burst 15 [S17] | yes | Already the backtest tape [R1] |
| Coinbase Advanced public | candles incl. 4 h (350 a call); 118 futures products with funding, margin rates, open interest | free | — | 10 req/s per IP [S16] | yes | Carry and margin for a short-side study |
| **Binance bulk** (`data.binance.vision`, `data-api.binance.vision`) | spot klines as monthly/daily ZIPs; futures funding; daily metrics (open interest, long/short ratios) | free, no key | spot 4 h: BTC and ETH from 2017-08, SOL 2020-08, AVAX 2020-09, SUI 2023-05; funding from 2020-01; metrics from 2020-09 (measured) | files | yes; `api.binance.com` answers 451 | ~10–12 more months of SOL and AVAX; funding and open interest as regime inputs |
| **Deribit public** | DVOL (implied-volatility index), perpetual funding history, options data | free, no key | DVOL BTC from 2021-03-24; BTC-PERPETUAL funding back to at least 2019-05-01 (measured) | — | yes | Test "no entry when implied vol is extreme" against the rule's realised-vol filter |
| **Bitstamp public** | OHLC (steps incl. 4 h), tickers, order book | free, no key | daily from BTC 2011-08-18, ETH 2017-08-16, AVAX 2022-03-08, SOL 2022-08-18, SUI 2023-05-05 (measured) | 1,000 bars a call; 400 req/s [S19] | yes | A third USD tape for tape-robustness checks |
| Kraken public | OHLC (720 most recent bars); quarterly OHLCVT bundle (full history) | free | per [R3 §2b] | — | yes | Already the signal venue |
| OKX public (v5) | candles, funding-rate history, open interest | free | BTC-USDT 4 h back to 2018-12-31 (measured) | — | yes | Cross-check funding. UK users cannot trade via its API, but the data is public |
| Bybit public | `api.bybit.com` answers 403 to a US IP; `public.bybit.com` bulk files are reachable: linear trades from 2020-03-25, premium index, spot (measured) | free | — | — | partly | Only if other funding sources fail |
| CoinGecko | prices, market caps, exchange data | Demo free: 100 calls/min, 10k credits a month, attribution required. Basic $35 a month: 300/min, 100k credits, 2 years of daily history [S91] | Demo: 1 year (review) | as left | yes | Market-cap ranks for universe screens (reference §3.8) |
| Coin Metrics Community | on-chain and market metrics, reference rates | free, non-commercial | long | 10 requests per 6 s per IP [S92] | yes | Slow regime inputs |
| CoinDesk Data (ex-CryptoCompare) | — | free tier retired 2026-05-21 [S93]; key required (measured 401) | — | — | no | Skip |
| Glassnode | on-chain | API only on the Professional plan plus an API add-on [S94] | — | — | — | Skip |
| DefiLlama | TVL, stablecoin supply | free, no key; Pro $300 a month (docs, secondary) | — | — | yes | Stablecoin-supply growth as a liquidity regime input |
| alternative.me Fear & Greed | daily index | free | since February 2018 (measured) | — | yes | A sentiment regime study |
| FRED | macro series | free; keyless CSV works (measured); API key free, 120 req/min (secondary) | e.g. DGS10 from 1962 | — | yes | Macro inputs for the BTC-regime filter candidate (reference §3.9) |
| Tiingo | US equities and ETFs EOD, IEX intraday, crypto | free: 500 symbols a month, 50 req/h, 1,000 a day (pricing, via search) | 30+ years EOD | as left | not tested | Cheapest way to backtest an ETF trend rule before choosing a broker |
| Alpaca market data | US equities (IEX feed, ~2.5 % of volume), crypto | free basic plan: 200 req/min (docs, via search) | minute bars 5+ years | as left | yes (crypto book, measured) | Live ETF quotes if Alpaca is used |
| Massive (ex-Polygon), Twelve Data, EODHD | equities | free: 5 calls/min and 2 years; 8/min and 800 a day; 20 calls a day and 1 year (pricing pages, via search; Massive secondary) | as left | as left | not tested | Only if Tiingo falls short |

## 8. The Coinbase answer

**Why the backtests use Coinbase data, and why that needs no account.**
`supabase/functions/agents/backtest.ts` reads pre-pulled Coinbase Exchange
1-hour tapes (files like `BTC-USD_1h_3y.json`) and resamples them to 4-hour
and daily bars [R1]. The tapes were fetched by
`scraps/agents-baseline-backtest.py` (on `origin/main` it now lives at
`docs/agents/scripts/agents-baseline-backtest.py`), line 41 [R2]. It calls
the **public** endpoint
`https://api.exchange.coinbase.com/products/{product}/candles?granularity=3600`
with plain `urllib`: no headers, no key, no account. That endpoint answered
keylessly from this container on 2026-09-22 (measured). Its public limit is
10 requests a second per IP [S17]. The live loop does not read Coinbase at
all: it decides on Kraken's candles and trades on Revolut X [R4 §2]. A
failed Coinbase signup therefore changes nothing in the data or the loop.

**Why a UK signup usually fails.** From Coinbase's help pages (direct fetch
refused with 403; read through search results) [S18] and the FCA rules
[S1]:

1. **Identity verification.** Blurry or expired documents, or a name that
   does not match the account, are the most common causes. Proof of
   residence may be requested.
2. **The FCA journey, which blocks trading rather than the account.**
   Every new UK customer must classify himself (restricted, high-net-worth
   or sophisticated investor) and pass an appropriateness test. A failed
   test can be retaken once at once; after two failures there is a
   24-hour wait. First-time investors also wait out a 24-hour cooling-off
   period that cannot be skipped. Many UK users were blocked from trading
   this way in January 2024 [S18].
3. **Risk decisions.** Location or IP mismatches, device signals, or a
   profile the firm treats as higher risk can stop onboarding. Coinbase's
   UK arm was fined £3.5m in 2024 for onboarding 13,416 high-risk customers
   while barred from doing so [S7]. My inference, not a stated policy: it
   is likely to be conservative, and a risk refusal may come without a
   reason.

**Is there a retry route?** Yes, within limits. Redo identity verification
with a current UK-issued document whose name matches exactly, from a UK
connection without a VPN. If the block was the appropriateness test, wait
24 hours and retake it. If the screen said Coinbase "cannot offer"
services, ask support; there is no public appeal route. As a US resident
with an SSN, Coinbase US would be a separate account (§3.2). None of this
matters for data. If the public endpoint ever closed, Bitstamp's OHLC
(BTC from 2011), Binance's bulk files and Kraken's quarterly bundle are
keyless substitutes (§7).

## 9. Records and tax (general information, not advice)

In the **UK**, every disposal is a CGT event, including a swap from one
coin to another or into a stablecoin. Gains are taxed at 18 % within the
basic-rate band and 24 % above it, after a £3,000 annual exempt amount
[S100]. Each token is matched first to same-day buys, then to buys in the
next 30 days, then to its Section 104 pool (HMRC CRYPTO22200) [S100].
Many small trades therefore need a per-trade log: time, pair, quantity,
price, GBP value at the time, fee and venue order id. The loop's own order
and fill tables already hold most of that. UK platforms collect data for
the OECD's CARF from 2026-01-01, with the first reports due 2027-05-31
(secondary). Spread-bet gains fall outside CGT, and their losses cannot be
offset. In the **US**, citizens and green-card holders file on worldwide
income wherever they live [S101]. Each crypto disposal is a capital gain
or loss. Brokers report gross proceeds on Form 1099-DA from 2025 and cost
basis for assets bought from 2026 [S101]. Regulated futures such as CME's
fall under section 1256 (60/40, marked to market); whether Coinbase's
perp-style contracts do is UNVERIFIED. The wash-sale rule was not applied
to crypto as of mid-2026 (secondary). A US person holding non-US funds
(UK UCITS ETFs, HK ETFs) meets the PFIC rules and Form 8621 [S101]. **Hong
Kong** has no capital gains tax. Profits count as taxable business income
only if the trading amounts to a business (the "badges of trade";
revised DIPN 39 on digital assets) [S102]. Keep the same per-trade log on
every route: it is the evidence in each system.

## 10. Open questions for Davies

1. **US route.** Which state would he live in? Does he have an SSN or an
   ITIN? Is he a US citizen or green-card holder? If so, US tax applies
   wherever he lives.
2. **HK route.** Does he have an HKID or HK residential-address proof, and
   an HK bank account? Does he hold only mainland-China ID?
3. **Size.** At the current size Revolut X is the best venue on every
   route he can use. Several cheaper or wider routes only pay at larger
   tickets (futures contracts; per-order minimums). Does he want to stay
   small or scale?
4. **Host.** Would he run a small always-on host (a VM) for IBKR's gateway
   or Futu's OpenD? The Edge Function cannot run either.
5. **Shorting study.** Should the next backtest session price a symmetric
   long/short trend rule on the four windows, with funding as carry?
6. **Bitstamp's fee tier.** Should someone open an account and read its
   real fee tier through the fee endpoint (`POST /api/v2/fees/trading/`)?
7. **Coinbase.** Does he still want an account (only for trading; data
   needs none)? What did the refusal screen say: identity verification,
   the appropriateness test, or "unable to offer"?
8. **Data.** Which of the three additions (Binance bulk, Deribit, Bitstamp
   OHLC) should the next backtest session wire in first?

## 11. Binance and Deribit, with Davies' own keys (2026-09-23)

Davies holds a Binance spot account and a Deribit account, and put an API
key for each into the project's secrets. Neither account holds money;
Binance can be funded and Deribit cannot. What each key may do was read
from the server, read-only (reference, "Binance and Deribit keys"). This
section is what the two are good for.

### 11.1 What is allowed

- **Binance.** It has not taken new UK users since 2023-10-16 17:00 UK
  time; an existing UK user who completed the investor declaration and the
  appropriateness test keeps the services they had, with no new products
  [S104]. Spot is one of them, and the probe shows the account can trade
  spot. No Binance company is authorised in the UK, so neither the
  Financial Ombudsman nor the FSCS covers it, and the FCA's regime, which
  starts on 2027-10-25, requires an unauthorised firm to stop serving UK
  customers then [S4]. Derivatives stay closed to UK retail (the FCA ban,
  §4). Every GBP pair is suspended, so money arrives as crypto or
  stablecoins, and every price is in USDT, not USD.
- **Deribit.** "Deribit does not currently offer its services to UK
  Retail Clients" — only professional clients and eligible counterparties
  (help centre, updated 2026-09-15) [S105]. That is why the account cannot
  be funded. Everything useful Deribit publishes is keyless.

### 11.2 What the keys can reach

- **Binance** refuses US addresses: `api.binance.com` answers this
  repository's development container, which reaches the internet from the
  US, with 451 ("restricted location"), and the project's Edge Functions
  in eu-west-2 (London) with 200. A function runs in the region
  nearest its caller unless the call pins one with `x-region` or
  `forceFunctionRegion`, and a pinned call is not rerouted during an
  outage [S106]; the loop is called from the database in London, so it
  runs there. Edge Functions have no fixed egress address [S107], so the
  key cannot be limited to an IP. Market data comes keyless from
  `data-api.binance.vision`, from anywhere.
- **Deribit**: the key adds rate-limit headroom and nothing the loop
  needs. DVOL (the 30-day implied volatility index) is public, daily and
  hourly back to 2021-03-24, for BTC and ETH only.

### 11.3 What the key permissions should be

Both keys can do more than anything here needs. Binance's has spot
trading and universal transfer on (withdrawals off, no IP restriction);
Deribit's token carries `trade:read_write`. Until a use is decided, switch
Binance's "Enable Spot & Margin Trading" and universal transfer off, and
issue Deribit's key read-only.

### 11.4 What they are good for

Ranked by what they could earn for the effort, from the desk research,
then priced where a backtest can price them.

1. **Binance as the venue for the thinner coins.** On the five live coins
   Binance quotes one tick wide. Twenty paired samples of both books
   (2026-09-23 02:21–02:31 UTC, recomputed from the raw file) put the
   median spread at BTC 1.6 / ETH 1.8 / SOL 3.6 / AVAX 9.0 / SUI 23.6 bps
   on Revolut X's UK book against 0.0 / 0.0 / 0.8 / 0.9 / 1.0 on Binance.
   With each venue's taker fee on both legs (9 bps on Revolut X, 10 on
   Binance, 7.5 with BNB) a round trip costs the same on BTC, ETH and SOL
   (~20 bps), and less on the thin two: AVAX 27.0 → 20.9 and SUI 41.6 →
   21.0 bps at that hour. SUI's own 60-sample median on Revolut X is
   14.9 bps (~33 bps a round trip, reference §3.20), so ~12 bps a round
   trip is the fair saving there, not ~20. Binance's depth would also
   lift the $100k-a-day book bar that kept POL out (§3.8). Prices are in
   USDT, not USD. **Priced, pre-registered: it changes no verdict**
   (reference §3.22). The live row's worst window does not move, SUI's
   seat stays undecided (it is still the weakest of the five on Binance's
   tight book), and no coin clears the bar at Binance's cost. At this tier
   Binance is not worth moving the row for.
2. **Volatility-sized slots, and DVOL or funding as entry gates.** Priced
   on the live row, pre-registered: all three fail the bar (reference
   §3.21). Nothing changes.
3. **Recording them as inputs.** DVOL and funding cost one keyless call a
   day each and could go on every decision row, as the loop already
   records its state, so that a later study reads the live record rather
   than a reconstruction. Not built: nothing reads them yet.

### 11.5 What they cannot do

- **No shorting and no derivatives** for a UK retail account on either
  venue (the FCA ban, §4); Binance keeps UK retail on spot, and Deribit
  does not take UK retail at all.
- **No arbitrage** worth the fees: the loop's own basis record between
  Revolut X and Kraken never came near the cost of crossing (reference
  §2c), and Binance's book adds a third price, not a free one.

## Sources

All read 2026-09-22 or 2026-09-23 (UTC). "Via search" means the page
refused a direct fetch and was read through indexed search results.
"Secondary" and "review" mean a third-party page, not the platform or the
regulator.

**Repository (read 2026-09-22)**

- [R1] `supabase/functions/agents/backtest.ts`, header lines 8–11.
- [R2] `scraps/agents-baseline-backtest.py` line 41; on `origin/main`,
  `docs/agents/scripts/agents-baseline-backtest.py` line 41.
- [R3] `docs/agents/reference.md` §2, §2.1, §2.3, §2.4, §2b, §2c, §3.6,
  §3.12, §4 items 15, 16, 23.
- [R4] `docs/agents/go-live.md` §1–§5.

**UK regulation**

- [S1] FCA PS23/6, financial promotion rules for cryptoassets (via search):
  https://www.fca.org.uk/publications/policy-statements/ps23-6-financial-promotion-rules-cryptoassets
- [S2] FCA, "FCA opens retail access to crypto ETNs", 2025-08-01:
  https://www.fca.org.uk/news/press-releases/fca-opens-retail-access-crypto-etns
- [S3] FCA PS20/10:
  https://www.fca.org.uk/publications/policy-statements/ps20-10-prohibiting-sale-retail-clients-investment-products-reference-cryptoassets
- [S4] FCA, new cryptoasset regime (page updated 2026-09-16):
  https://www.fca.org.uk/firms/new-regime-cryptoasset-regulation/registration-under-mlrs-ahead-new-fsma-regime
- [S5] FCA Handbook COBS 3.5.3R (read 2026-09-23):
  https://www.handbook.fca.org.uk/handbook/COBS/3/5.html ; CP25/36
  summary (via search):
  https://www.simmons-simmons.com/en/publications/cmiyksa4z003ouj4gb3faozxl/fca-cp25-36-a-dramatic-overhaul-of-client-categorisation-rules
- [S6] FCA, Gemini's UK exit, 2026-02-06:
  https://www.fca.org.uk/news/news-stories/gemini-exit-uk-market
- [S7] FCA, CB Payments fine, 2024-07-25:
  https://www.fca.org.uk/news/press-releases/fca-first-enforcement-action-against-firm-enabling-cryptoasset-trading

**UK venues**

- [S10] OKX, "What can I use in the United Kingdom" (updated 2026-09-17):
  https://www.okx.com/en-gb/help/okx-what-can-i-use-in-the-united-kingdom
- [S11] OKX UK financial-promotions FAQ (updated 2026-08-26):
  https://www.okx.com/en-us/help/united-kingdom-uk-financial-promotions-faq
- [S12] Bybit UK launch release, 2025-12-19:
  https://www.prnewswire.com/news-releases/bybit-launches-in-the-uk-to-meet-rising-demand-for-digital-asset-platforms-302646800.html ;
  CoinDesk:
  https://www.coindesk.com/business/2025/12/19/bybit-returns-to-uk-with-100-crypto-trading-pairs-after-2-year-break ;
  Bybit fees (via search):
  https://www.bybit.com/en/help-center/article/Trading-Fee-Structure
- [S13] Cointelegraph, 2026-08-17:
  https://cointelegraph.com/news/binance-uk-launch-plans-fca-license
- [S14] Coinbase fee change, 2026-09-16: securities.io
  https://www.securities.io/coinbase-lowers-advanced-trading-fees-with-tiers-starting-at-10-000/ ;
  CryptoDaily https://cryptodaily.co.uk/2026/09/coinbase-advanced-fees-usdc-vip-tiers ;
  Investing.com
  https://www.investing.com/news/cryptocurrency-news/coinbase-cuts-trading-fees-for-active-users-on-advanced-platform-432SI-4904040
- [S15] Coinbase licences (via search):
  https://www.coinbase.com/legal/licenses/europe
- [S16] Coinbase Advanced Trade API:
  https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api.md ;
  authentication
  https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication ;
  sandbox https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox ;
  rate limits (via search)
  https://docs.cloud.coinbase.com/advanced-trade/docs/rest-api-rate-limits
- [S17] Coinbase Exchange rate limits:
  https://docs.cdp.coinbase.com/exchange/introduction/rate-limits-overview.md
- [S18] Coinbase help (via search):
  https://help.coinbase.com/en-gb/coinbase/getting-started/getting-started-with-coinbase/fca-financial-promo-changes ;
  https://help.coinbase.com/en/coinbase/getting-started/verify-my-account/idv-tips ;
  Disruption Banking, 2024-01-04
  https://www.disruptionbanking.com/2024/01/04/coinbase-blocks-trading-for-users-in-the-uk-why/ ;
  SSN (via search) https://help.coinbase.com/en/coinbase/taxes/forms-reports/w9
- [S19] Bitstamp blog, 2022-12-15:
  https://blog.bitstamp.net/post/lower-trading-fees-for-maker-orders-and-stablecoins/ ;
  CryptoSlate review https://cryptoslate.com/crypto-exchanges/bitstamp-exchange-review/ ;
  TradingFinder https://tradingfinder.com/exchanges/bitstamp/ ;
  API https://www.bitstamp.net/api/ ; fee page (bot-protected)
  https://www.bitstamp.net/fee-schedule/
- [S20] Robinhood, trading crypto on Bitstamp UK:
  https://robinhood.com/gb/en/support/articles/trading-crypto-on-bitstamp-uk/ ;
  The Block, 2026-08-10
  https://www.theblock.co/news/business/2026-08-10-robinhood-uk-crypto-trading-bitstamp-411140 ;
  FinanceFeeds
  https://financefeeds.com/robinhood-launches-crypto-trading-for-uk-customers-through-bitstamp/
- [S21] Crypto.com: CryptoSlate review
  https://cryptoslate.com/crypto-exchanges/crypto-com-exchange-review/ ;
  Good Money Guide https://goodmoneyguide.com/review/crypto-com/ ;
  API docs (via search)
  https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html ;
  US launch, 2025-01-21
  https://crypto.com/us/company-news/crypto-com-exchange-set-for-u-s-launch
- [S22] Bitpanda:
  https://blog.bitpanda.com/en/bitpanda-secures-fca-approval-uk-expansion ;
  https://www.bitpanda.com/en/fusion ; https://www.bitpanda.com/en/fusion/api
- [S23] Bitfinex notice to UK customers:
  https://blog.bitfinex.com/announcements/notice-to-uk-customers/
- [S24] eToro public APIs:
  https://www.etoro.com/news-and-analysis/press-releases/etoro-marks-15-years-of-social-investing-with-launch-of-public-apis-and-expansion-of-copytradertm-to-the-us/ ;
  https://api-portal.etoro.com/llms.txt ; fees https://www.etoro.com/trading/fees/
- [S25] CEX.IO, 2026-03-12:
  https://blog.cex.io/company-updates/cex-io-secures-fca-registration-in-the-uk-35437 ;
  fees (review) https://cryptoreview.co.uk/best-crypto-exchanges/cex-io-review
- [S26] CryptoSlate on Luno, 2026-08-03:
  https://cryptoslate.com/luno-blocked-crypto-transfers-for-some-users-now-they-must-sell-this-month-or-watch-monthly-fees-drain-their-accounts/
- [S27] CoinJar UK fees: https://www.coinjar.com/uk/fees
- [S28] Kraken fee schedule: https://www.kraken.com/features/fee-schedule ;
  licences: support.kraken.com, "Where is Kraken licensed or regulated?"
- [S29] IG spot crypto, 2026-06-16:
  https://www.ig.com/uk/trading-strategies/buy-bitcoin-zero-commission-fees-compared-260615 ;
  IG Labs API limits (via search) https://labs.ig.com/node/158
- [S30] Business Wire, IBKR UK crypto, 2024-05-08:
  https://www.businesswire.com/news/home/20240508125225/en/Interactive-Brokers-Launches-Cryptocurrency-Trading-for-UK-Clients
- [S31] Revolut X availability: Decrypt
  https://decrypt.co/291388/revolut-crypto-trading-30-european-countries ;
  Finextra https://www.finextra.com/newsarticle/45053/revolut-to-ship-crypto-exchange-to-30-eu-markets ;
  registration (The Block, secondary) https://www.theblock.co/post/173021

**US venues and derivatives**

- [S40] Binance.US: zero fees https://blog.binance.us/zero-fee-trading/ ;
  states
  https://support.binance.us/en/articles/9842798-list-of-supported-and-unsupported-states-and-regions ;
  ID policy
  https://support.binance.us/en/articles/9842808-acceptable-identity-documents-policy ;
  API https://docs.binance.us
- [S41] Kraken US (page dated 2026-03-30):
  https://support.kraken.com/articles/quick-start-for-clients-in-the-united-states ;
  verification
  https://support.kraken.com/articles/201352206-verification-level-requirements
- [S42] Gemini ActiveTrader fees (effective 2026-09-01):
  https://www.gemini.com/fees/activetrader-fee-schedule
- [S43] OKX US fee framework (effective 2026-02-01):
  https://www.okx.com/en-us/help/updates-to-us-fee-framework-2026 ;
  https://www.okx.com/en-us/okx-api
- [S44] Robinhood crypto fee schedule:
  https://cdn.robinhood.com/assets/robinhood/legal/rhc-fee-schedule.pdf ;
  Crypto Trading API https://docs.robinhood.com/crypto/trading/
- [S45] Alpaca crypto fees https://docs.alpaca.markets/us/docs/crypto-fees ;
  non-US accounts https://alpaca.markets/learn/live-trading-account-non-us ;
  HK (review)
  https://brokerchooser.com/broker-reviews/alpaca-trading-review/alpaca-trading-hong-kong
- [S46] Coinbase Derivatives fee filing (CFTC, 2025-11-26):
  https://www.cftc.gov/sites/default/files/filings/orgrules/25/11/rules11262533688.pdf ;
  Coinbase blog https://www.coinbase.com/blog/perpetual-futures-have-arrived-in-the-us ;
  CryptoNews
  https://cryptonews.com/news/coinbase-launches-cftc-regulated-perpetual-futures-for-us-retail-traders/ ;
  public product data
  https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE
  (measured)
- [S47] CFTC, 2026-05-29: https://www.cftc.gov/PressRoom/PressReleases/9240-26 ;
  https://www.cftc.gov/PressRoom/PressReleases/9241-26
- [S48] Kalshi BTC perpetual specifications (2026-06-03):
  https://help.kalshi.com/en/articles/15357587-btc-perpetual-futures-contract-specifications ;
  Crypto Times, 2026-06-03
  https://www.cryptotimes.io/2026/06/03/kalshi-brings-bitcoin-perps-to-the-u-s-no-expiry-no-fees-for-now/ ;
  Crypto Times, 2026-09-21
  https://www.cryptotimes.io/2026/09/21/kalshi-faces-accusations-of-inflated-crypto-volume-over-repeated-5500-perp-trades/ ;
  API https://docs.kalshi.com/welcome
- [S49] Kraken US perps: blog, 2026-06-15
  https://blog.kraken.com/product/kraken-derivatives/announcing-cftc-regulated-us-perps ;
  fees (updated 2026-06-15) https://support.kraken.com/articles/us-futures-fees ;
  https://support.kraken.com/articles/us-perpetual-futures
- [S50] CME 24/7 crypto:
  https://www.cmegroup.com/media-room/press-releases/2026/6/01/cme_group_announceslaunchof247cryptocurrencyfuturesandoptionstra.html ;
  AVAX and SUI futures:
  https://www.cmegroup.com/media-room/press-releases/2026/5/06/cme_group_announcesfirsttradesofnewavalancheandsuicryptocurrency.html ;
  Micro Bitcoin margin (Schwab, via search)
  https://www.schwab.com/learn/story/micro-bitcoin-and-ether-futures-offer-small-bites-crypto
- [S51] Schwab crypto press release, 2026-04-16 (earlier session);
  Schwab Trader API token expiry (schwab-py documentation, secondary);
  E*TRADE token renewal https://developer.etrade.com
- [S52] tastytrade fees https://tastytrade.com/commissions-and-fees/ ;
  API https://developer.tastytrade.com/ ; UK clients (review)
  https://brokerchooser.com/broker-reviews/tastytrade-review/tastytrade-uk ;
  OANDA UK (review) https://www.compareforexbrokers.co.uk/reviews/oanda/ ;
  OANDA v20 https://developer.oanda.com/rest-live-v20/introduction/
- [S53] Webull OpenAPI https://developer.webull.com/apis/docs/ ;
  UK https://developer.webull-uk.com/apis/docs/ ; moomoo and the UK
  (review) https://brokerchooser.com/broker-reviews/moomoo-review/moomoo-uk
- [S54] IBKR US crypto (Business Wire 2026-07-14, via search; The Block,
  2025-03-26); IBKR Web API for individuals (IBKR Campus, via search)

**Hong Kong**

- [S60] SFC list of licensed platforms (updated 2026-05-29):
  https://www.sfc.hk/en/Welcome-to-the-Fintech-Contact-Point/Virtual-assets/Virtual-asset-trading-platforms-operators/Lists-of-virtual-asset-trading-platforms
- [S61] Fintech News HK, retail status table (2026-05-20):
  https://fintechnews.hk/licensed-crypto-exchanges-hong-kong/
- [S62] SFC/HKMA joint circular, 2023-10-20, paras 7.1 and 8:
  https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20231020-7-EN/20231020-7-EN.pdf
- [S63] Charltons on the SFC circular of 2026-02-11 (published 2026-02-19):
  https://www.charltonslaw.com/sfc-virtual-asset-update-new-guidance-on-va-margin-financing-perpetual-contracts-and-affiliated-market-makers/
- [S64] ONC on the SFC's 2025 update:
  https://www.onc.hk/en_US/publication/sfc-s-2025-update-to-the-virtual-asset-regime
- [S65] HashKey: `exchangeInfo`
  https://api-pro.hashkey.com/api/v1/exchangeInfo (measured) ; fee notice
  (via search)
  https://support.hashkey.com/hc/en-gb/articles/49134161022745-Notice-on-Adjustment-of-Trading-Fee-on-HashKey-Exchange ;
  API https://hashkeypro-apidoc.readme.io ; account opening (via search)
  https://support.hashkey.com/hc/en-gb/articles/39954789987225-Guidance-of-account-opening-for-retail-customers-in-HashKey-Exchange-Hong-Kong ;
  fee 0.12 % vs 0.29 % (reviews) https://www.datawallet.com/crypto/best-crypto-exchanges-hong-kong
- [S66] OSL API https://osl.com/reference/introduction ; OSL VIP fees
  https://www.osl.com/hk-en/bits/article/hong-kong-lowest-crypto-trading-fees-osl-vip
- [S67] Futu HK crypto fees (effective 2026-07-15)
  https://www.futuhk.com/support/topic2_1746 ; crypto futures
  https://www.futuhk.com/support/topic2_1779 ; OpenAPI https://openapi.moomoo.com ;
  OpenD https://openapi.futunn.com/futu-api-doc/en/opend/opend-intro.html ;
  AVAX listing
  https://www.tradingview.com/news/coinmarketcal:8d45547f5094b:0-avalanche-avax-panthertrade-listing-16-may-2026/
- [S68] Tiger HK virtual assets https://www.itiger.com/hk/en/invest/virtual-assets ;
  Open API enumerations
  https://quant.itigerup.com/openapi/en/java/appendix2/overview.html ;
  introduction https://quant.itigerup.com/openapi/en/python/overview/introduction.html
- [S69] Longbridge OpenAPI FAQ https://open.longbridge.com/docs/qa/general
- [S70] Business Wire, IBKR HK crypto via OSL, 2023-11-27 (earlier session)
- [S71] CoinDesk, OKX leaves HK, 2024-05-24
  https://www.coindesk.com/business/2024/05/24/crypto-exchange-okx-withdraws-hong-kong-license-application ;
  Bybit affiliate withdraws
  https://fintechnews.hk/29261/blockchain/bybit-affliate-spark-fintech-limited-withdraws-crypto-application/ ;
  DL News, unlicensed in HK
  https://www.dlnews.com/articles/markets/binance-coinbase-and-kraken-are-unlicenced-in-hong-kong/
- [S72] Charltons on the VATP guidelines (via search):
  https://www.charltonslaw.com/hong-kong-sfc-finalises-regulation-of-virtual-asset-trading-platforms/
- [S73] Mainland-client restrictions and CSRC penalties (Caproasia
  2025-09-25; 36Kr; Yicai; secondary, earlier session)

**ETFs and ETNs**

- [S80] Morningstar UK
  https://global.morningstar.com/en-gb/etfs/can-i-buy-a-bitcoin-spot-etf-in-the-uk ;
  CoinDesk, 2025-10-20
  https://www.coindesk.com/markets/2025/10/20/blackrock-uk-bitcoin-etp-starts-trading-in-london-after-fca-eases-crypto-ban
- [S81] Trading 212: ETNs in ISAs
  https://helpcentre.trading212.com/hc/en-us/articles/31007919710365-Crypto-ETNs-in-ISA-accounts ;
  ETN approval
  https://helpcentre.trading212.com/hc/en-us/articles/30591328588573-How-to-obtain-approval-to-invest-in-Crypto-ETNs ;
  BTC/ETH only (review)
  https://www.theinvestorscentre.co.uk/reviews/trading-212-review/bitcoin-on-trading-212/ ;
  API docs https://docs.trading212.com/api ; order types
  https://community.trading212.com/t/trading-212-api-update/87988 ;
  CoinDesk, 2026-02-26
  https://www.coindesk.com/policy/2026/02/26/uk-investors-only-have-until-april-to-add-crypto-etns-to-their-isas-ft
- [S82] Ashurst on CCI replacing PRIIPs:
  https://www.ashurst.com/en/insights/consumer-composite-investments-replace-uk-priips-412026-33515-pm/
- [S83] US and HK crypto ETFs (earlier session, secondary): Motley Fool
  2026-04-24 (IBIT/ETHA fees); CoinDesk, The Block and Nasdaq (SOL, AVAX
  and SUI ETFs); The Block and CNBC (HK spot ETFs, 2024-04-30); ETF
  Express and Business Wire (CSOP 7376, 2024-07-23)

**Data**

- Measured endpoints (2026-09-22/23): `api.exchange.coinbase.com`,
  `api.coinbase.com/api/v3/brokerage/market/…`, `data.binance.vision`,
  `data-api.binance.vision`, `api.binance.com` (451), `www.deribit.com/api/v2/public/…`,
  `www.bitstamp.net/api/v2/…`, `www.okx.com/api/v5/…`, `api.bybit.com`
  (403), `public.bybit.com`, `api-pro.hashkey.com`,
  `data.exchange.coinjar.com`, `data.alpaca.markets`, `api.binance.us`,
  `api.crypto.com`, `api.gemini.com`, `revx.revolut.com`, `api.kraken.com`,
  `api.alternative.me`, `fred.stlouisfed.org`, `community-api.coinmetrics.io`,
  `api.llama.fi`, `api.coingecko.com`, `min-api.cryptocompare.com` (401),
  `api.elections.kalshi.com`.
- [S91] CoinGecko API pricing: https://www.coingecko.com/en/api/pricing
- [S92] Coin Metrics Community API:
  https://gitbook-docs.coinmetrics.io/access-our-data/api
- [S93] CoinDesk Data free-tier change:
  https://data.coindesk.com/blogs/changes-to-coindesk-data-indices-api-free-tier-access
- [S94] Glassnode API: https://docs.glassnode.com/basic-api/api
- Tiingo, Massive, Twelve Data, EODHD, Alpaca data, DefiLlama Pro and
  FRED API limits: pricing and docs pages read via search (earlier
  session).

**Tax and protection**

- [S100] GOV.UK CGT rates https://www.gov.uk/capital-gains-tax/rates ;
  allowance https://www.gov.uk/capital-gains-tax/allowances ; HMRC
  CRYPTO22200
  https://www.gov.uk/hmrc-internal-manuals/cryptoassets-manual/crypto22200
- [S101] IRS, citizens abroad
  https://www.irs.gov/individuals/international-taxpayers/us-citizens-and-resident-aliens-abroad ;
  Form 1099-DA https://www.irs.gov/businesses/understanding-your-form-1099-da ;
  Form 8621 https://www.irs.gov/forms-pubs/about-form-8621
- [S102] HKICPA A Plus:
  https://aplus.hkicpa.org.hk/ird-issues-guidance-on-cryptocurrency-taxation/
- [S103] FSCS https://www.fscs.org.uk ; SIPC https://www.sipc.org ; SFC
  Investor Compensation Fund FAQ https://www.sfc.hk
- [S104] Binance, "Update on Binance for UK users" (2023-10-16):
  https://www.binance.com/en-GB/blog/all/update-on-binance-for-uk-users-937596818854026589
- [S105] Deribit help centre, "UK Client Categorisation" (updated 2026-09-15):
  https://support.deribit.com/hc/en-us/articles/34156799518109-UK-Client-Categorisation
- [S106] Supabase, "Regional invocation":
  https://supabase.com/docs/guides/functions/regional-invocation
- [S107] Supabase, "Why Edge Functions cannot provide static egress IPs":
  https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0
