# CXBOT, the Grok crypto bot: an independent audit before anything is built (2026-10-29)

Davies, 2026-10-29: "和ig的策略审核一样，再派一个独立的subagent仔细深度审核下加密货币 Grok 交易系统，其中提到的币安，Bybit，OKX等币所我这边
都有国际站账号可以做空，只判断对策略来说最优的币所，给grok的prompt里也需要提供具体的数据和概率推断来源等，确保一切设定最佳". Then the main
session builds the architecture and the prompt and starts **Phase 1**: paper trading on live public market data, shown in
TESTING, with no exchange key. And, the same day: the bot gets GROKPM's and IGBOT's Claude ↔ Grok desk ledger, and (IG's
lesson of the day) the recorder and the bot never share a private session or key.

**What this is.** An adversarial audit of `reviews/2026-10-29-crypto-grok-bot-research.md` (the research), with the
corrected design. It read the research, GROKPM (`supabase/functions/grokpm/`, its prereg with D1–D18, the reviews of 10-23,
10-27, 10-28) and IGBOT after its audit (`supabase/functions/igbot/`, `reviews/2026-10-29-igbot-research.md` §11, the
prereg's §5/§6/§10, `docs/agents/igbot/GROK_PROMPT.md`, `docs/agents/backtests/igbot/score.mjs`). Its outputs: this file,
marked corrections in the research ("[audit 2026-10-29]"), a DRAFT pre-registration (`reviews/2026-10-29-cxbot-phase1-prereg.md`),
a DRAFT prompt (`docs/agents/cxbot/GROK_PROMPT_DRAFT.md`), the desk ledger's seed (`docs/agents/cxbot/ledger_seed.md`) and the
scripts behind every number (`docs/agents/backtests/cxbot/`). **Nothing was built, placed, cancelled or changed; no credential
was read.** Production was read twice, read-only (the trend rows' fills, §3; OKX's recorder, §2.2). Every market number is
keyless public data taken 2026-10-29 00:12–00:25 UTC from this container, whose egress is in the US (Columbus, Ohio; a
Google address): a venue that refuses it says nothing about London. **Nothing here routes around a geoblock**: Binance's
futures API answers this container 451, and `www.binance.com/fapi/v1/ping` answers 200; the second host was NOT read for
data, because reading a blocked API through another of its hosts is routing round the block. Whether Davies' use of each
venue complies with its terms is his decision (his word, above); this audit does not re-open it. The repository is public:
no balance of his is written here.

## 1. Findings, ranked

| # | severity | finding | fixed in |
|---|---|---|---|
| F1 | critical | **The scoring the research inherits from IGBOT can be passed without skill.** A bracket neither side reaches within the hold is excluded, but crypto brackets often time out (a 2.5 %/5 % BTC bracket at 30 % vol: 57 % of them in 72 h), and among those that resolve the limit comes first far less often than m (0.166 against 0.333): the exclusion biases y down, so shading p down "beats" m. Simulated on martingale paths, forecasters with no skill pass IGBOT's bar in 8–32 % of 42-day windows (nominal 5 %). Fix: a bracket that times out is scored where the price stands, y = its fraction from stop (0) to limit (1); then E[y] = m exactly for any hold (optional stopping), the baseline needs no model, and no forecaster passed in 1,200 null windows. Plus a 3-day-block bootstrap and an oracle shift per (coin, direction) | §5; prereg §5–§6 |
| F2 | critical | **Grok chooses what is scored.** Own brackets and shadows are selected by the forecaster; so are Phase 0's forecasts as the research wrote them. Fix: **assigned questions**, issued by the server on a clock (both sides of each coin every 4 h; Polymarket's daily strikes nearest 0.25/0.50/0.75 at three horizons), every one answered or counted as missed; the primary bar is on them | §4, §5 |
| F3 | high | **Phase 1 cannot show an edge in money** (≈ 225 trades for t = 2 at +0.2 R; the research's arithmetic checks) and Davies starts there now. So the forecast layer runs INSIDE Phase 1, from day one, on the same clock; the window is 56 days; the power is stated (§5.4): a calibrated 8-point skill passes 20–34 % of the time, 13 points 65–86 %, 18 points 89 % | §4; prereg §3, §6 |
| F4 | high | **Venue**: the research ranked by UK terms; Davies holds international accounts at all four. For the strategy, **Hyperliquid first** (keyless verification of any address, an API wallet that cannot withdraw and needs no IP, the lowest fees, hourly transparent funding, stops on a CEX-consensus mark), **Binance USDⓈ-M second** (deepest, the full public history, the source Polymarket's crypto questions resolve on), OKX third, Bybit fourth. Execution cost does not separate them at our size (impact ≤ 0.5 bps at $10k; fees differ by ≤ 1.5 bps a side) | §2 |
| F5 | high | **Reachability from our Edge is measured for OKX alone** (its recorder read 60 of 60 minutes to 00:17 UTC) and Binance spot (2026-09-23); Hyperliquid's API, Binance's futures API and Bybit's are not, and Bybit's API refuses cloud ranges and the US by its own guide. The build's first step is a keyless `reach` probe from eu-west-2; if Hyperliquid does not answer there, Binance becomes the venue; nothing is routed round a refusal | §2.2 |
| F6 | high | **Facts in the research that are wrong or have moved**: Hyperliquid's "$3.7M–$6.8M within 10 bps" summed the 20 full-precision levels, which span 2.4–2.5 bps (within 10 bps: $26.4M bid / $27.9M ask today); Polymarket's daily crypto questions resolve at 17:00 UTC from 2026-11-01, not 16:00 (US DST); Hyperliquid's 1-minute candles go back about 3.5 days (5,000 candles), so the record exists only if our recorder writes it from day one; its stop trigger is the MARK (settled, §2.3) | research, marked |
| F7 | high | **Market-implied probabilities disagree by 5–7 points** between Deribit and Polymarket on the same touches (Deribit's implied vol carries the variance premium). So no single "market p" is truth: the scored baseline is the model-free m, and Deribit, Polymarket and realised-vol figures are handed to Grok as computed context, every wake, by the server (§6) | §6; prompt |
| F8 | medium | **Rules**: the liquidation-distance rule refuses a 10 % stop at 3× (liquidation ≈ 32 %, needed ≥ 35 %): the server should choose leverage, not Grok; BTC/ETH/SOL move together (0.75–0.8), so three longs are one bet: a same-direction risk cap; stops in units of the coin's own daily volatility, not fixed percentages; the funding cap must read the predicted rate too | §7.2 |
| F9 | medium | **Paper fills** need writing down conservatively (stops triggered on trade prints, which wick past the mark; filled at the worse of the level less slippage and the next minute's open; limits only strictly through; taker fees; hourly funding at the recorded rate; a missed minute resolves at the next one's open) | §7.3 |
| F10 | medium | **Sessions and keys** (IG's lesson): on Hyperliquid the recorder reads any address's positions and fills with no key at all, so in a live phase it shares nothing with the bot by construction; on a CEX the recorder would need its own read-only key and the bot its own trade key, never one key for both. Phase 1 holds no key | §7.6 |
| F11 | medium | **IGBOT has F1 too, smaller**: on IG's geometry the resolved-only bias is −0.001 to −0.011 (its D_c guard catches a constant part), and its real brackets closed by the agent are excluded, which lets losers be cut out of the score. Not fixed here (IGBOT is not this audit's object): the main session should decide whether IGBOT's draft takes the same y | §5.2 |
| F12 | low | The Phase 1 testnet rehearsal needs a testnet key and proves nothing Phase 1 scores: moved to Phase 2's preparation. Phase 1 needs one secret, `CXBOT_TOKEN` | §8 |
| F13 | low | `agents/cb_releases.ts` calls NFP's date "the third-Friday rule"; NFP is the first Friday, and the dates it lists (11-06, 12-04) ARE first Fridays: a comment's wording, not a date error. Its CPI dates are still marked unconfirmed (Kalshi's `KXCPI-26OCT` exists; its release time was not read, 429) | not changed; noted |

## 2. Venue: the best for the strategy

### 2.1 What the strategy needs from a venue

Grok's trades are brackets held hours to days, sized at 1 % risk on a notional budget of about $1,000: a $10 loss at a
2–5 % stop is a $200–$500 position. At that size **depth and impact do not separate the venues** (§2.3: a $10k market buy
moves BTC ≤ 0.06 bps on Hyperliquid, ≤ 0.01 on OKX). What does matter, in order: (1) a stop that rests on the venue,
triggers on a fair price and survives our server and Grok being down; (2) a record we can score on, from data we hold;
(3) keys that cannot lose more than the account and need no fixed IP (Supabase Edge has none); (4) an independent check of
the bot's book that never touches the bot's key or session; (5) costs and funding, small but systematic; (6) reachability
from eu-west-2 without any routing; (7) custody and venue risk.

### 2.2 Reachability (public market data)

| endpoint | from this container (US) | from our Edge (eu-west-2) |
|---|---|---|
| Hyperliquid `api.hyperliquid.xyz/info` (POST) | 200 | **not measured** |
| Binance spot `api.binance.com`; `data-api.binance.vision`; archives `data.binance.vision` | 451; 200; 200 | `api.binance.com` 200 (reference, 2026-09-23) |
| Binance USDⓈ-M `fapi.binance.com`; options `eapi.binance.com` | 451; 451 | **not measured** |
| Bybit `api.bybit.com`, `api.bytick.com`; archives `public.bybit.com` | 403, 403; 200 | **not measured**. Bybit's v5 guide: US and mainland-China IPs get 403; a vendor reports its CDN refusing cloud ranges |
| OKX `www.okx.com/api/v5` (public) | 200 | **200**: `agents?action=okxrec` wrote 60 of 60 minutes of `okx_books` in the hour to 00:17 UTC (read-only SQL) |
| Deribit `www.deribit.com/api/v2/public` | 200 | 200 (the `probe` reads DVOL, reference §2d) |
| Polymarket Gamma, CLOB | 200, 200 | 200 (GROKPM's record and the recorders) |
| Kalshi `api.elections.kalshi.com/trade-api/v2` | 200, then 429 after three calls | not measured |
| Coin Metrics community, DefiLlama stablecoins | 200, 200 | not measured |
| Farside (ETF flows), cmegroup.com, CoinGlass | 403, timeout, key required | not measured |

**The build's first step** is a keyless `cxbot?action=reach` (cron bearer only), run from eu-west-2, that reads each of
these once and records status and latency. If Hyperliquid's `/info` does not answer from eu-west-2, the venue is Binance
(and if Binance's futures API refuses too, OKX, the one measured). Supabase's region is never chosen to get round a
refusal. **Private APIs later**: Hyperliquid's `/exchange` is the same host; Binance's and OKX's private hosts are their
public ones; whether each venue accepts the account from Davies' country is his matter, not a routing question.

### 2.3 The four, side by side (measured where marked; secondary sources named)

| | **Hyperliquid perps** | **Binance USDⓈ-M** | **OKX swap** | **Bybit linear** |
|---|---|---|---|---|
| spread, 2026-10-29 00:14 UTC, bps (BTC / ETH / SOL) | 0.12 / 0.42 / 0.98 (measured) | about one tick (CoinGecko reports ≤ 0.02 %, its floor; not read live, 451) | 0.012 / 0.042 / 0.98 (measured) | ≈ 1 tick (CoinGecko; 403) |
| depth within 10 bps, $M bid / ask (BTC; ETH; SOL) | 26.4 / 27.9; 8.7 / 8.3; 0.44 / 1.54 (nSigFigs 4) | ±20 bps median of 10-27: 61.3 / 62.8; 29.0 / 29.2; 5.7 / 5.8 (`bookDepth` archive) | ≥ 16.7 / 17.8 (400 levels reach 5 bps); 14.1 / 11.1; 1.39 / 1.88 | not read |
| impact of a $10k / $100k buy, bps over mid (BTC; ETH; SOL) | 0.06 / 0.06; 0.21 / 0.21; 0.49 / 0.49 | not read | 0.01 / 0.01; 0.02 / 0.02; 0.49 / 0.66 | not read |
| 24 h volume / open interest, BTC (CoinGecko 00:13 UTC) | $2.25B / $3.56B | $9.40B / $7.79B | $5.45B / $2.48B | $3.97B / $5.04B |
| fees at the entry tier, maker / taker | **0.015 % / 0.045 %** (docs, read today); staking up to −40 % | 0.020 % / 0.050 %; 0.018 / 0.045 paying in BNB (Binance FAQ, via search) | 0.020 % / 0.050 % (secondary) | 0.020 % / 0.055 % (Bybit help centre, via search) |
| round trip, maker in / taker out; taker both | 6.0; 9.0 bps | 7.0 (6.3 BNB); 10.0 (9.0) | 7.0; 10.0 | 7.5; 11.0 |
| funding | **hourly**; F = premium + clamp(0.00125 %/h − premium, ±0.05 %), cap 4 %/h; paid on the oracle price (docs). 500 h to now: BTC mean 0.0009 %/h (2.2 bps a day), 53 % of hours at the floor, min −0.0014 % | every 8 h on BTC/ETH/SOL (HL's `predictedFundings`, 00:15: BTC 0.0056 %, ETH 0.0061 %, SOL 0.0100 %); the same 0.01 %/8 h interest term | 8 h (secondary) | every 8 h (`predictedFundings`: BTC 0.0100 %, ETH 0.0100 %, SOL 0.0060 %) |
| stop trigger, attached to the entry | **mark price**, fixed (FAQ, "robust price indices": the mark is a median of the oracle plus a basis EMA, Hyperliquid's own bbo/last, and CEX perp mids weighted Binance 3, OKX 2, Bybit 2, Gate 1, MEXC 1); a triggered TP/SL is a market order with 10 % slippage tolerance or a limit; TP/SL can be grouped with the entry (SDKs; to confirm on the testnet) | mark or contract price (`workingType`, from memory); **since December 2025 conditional orders live in the Algo Service** (`POST /fapi/v1/algoOrder`, `algoType` CONDITIONAL, an `algoId`; the old path refuses −4120); not attached to the entry | `attachAlgoOrds` on the entry, `slTriggerPxType` last / index / mark (secondary) | `stopLoss` on the entry with `slTriggerBy` MarkPrice, `tpslMode` Full (official v5 docs) |
| isolated margin | per asset (`updateLeverage`, `isCross` false) | per symbol | per order (`tdMode` isolated) | per symbol (unified account) |
| liquidation | book first; over $100k only 20 % at a time; the liquidator vault below ⅔ of maintenance; **no clearance fee** (docs) | insurance clearance fee (rate on its trading-rules page, not read), insurance fund, ADL | fee and ADL (from memory) | fee and ADL (from memory) |
| rate limits | 1,200 weight a minute per IP (l2Book 2, `metaAndAssetCtxs` 20, candles 20+); address actions: 10,000 then 1 per USDC traded | per IP and per account (from memory: 2,400 weight a minute) | per endpoint (20 per 2 s on books) | per endpoint |
| test environment | testnet, its own chain and thin books | futures testnet (`testnet.binancefuture.com`, 200 from the US) | demo trading on live prices (from memory) | demo trading on live prices (from memory) |
| public history for scoring | **1-minute candles ≈ 3.5 days** (5,000; read: none 4 days back); funding 500 rows a call; an S3 archive, requester-pays | **everything, free**: klines, aggTrades, bookDepth, metrics (OI, long/short), funding (`data.binance.vision`; 10-27's files read) | trade archives (`static.okx.com`, 200) | trades (`public.bybit.com`, 10-27's file present) |
| keys from Supabase (no fixed IP) | **API wallet: signs only** ("only used to sign"; cannot withdraw per third-party SDK docs); no IP concept; never reuse a deregistered agent address | trade-only key without IP binding (withdrawal needs a binding) | trade-only key; one not bound to an IP is deleted after 14 days unused (from memory) | trade-only key; one not bound to an IP expires after 90 days (from memory) |
| an independent record of the bot's own book | **keyless**: `clearinghouseState`, `userFills`, `userFunding` for any address | needs a second, read-only key | needs a second, read-only key | needs a second, read-only key |
| custody | on chain: no exchange insolvency; bridge, validators, governance (the validators delisted a market and settled it in March 2025, from memory) | CEX | CEX | CEX (the February 2025 cold-wallet theft, covered by the venue; from memory) |
| from eu-west-2 | not measured | spot 200; futures not measured | **measured 200** | not measured; refusal risk |

### 2.4 The ranking

1. **Hyperliquid.** For this strategy the deciding points are (3) and (4): an API wallet that signs and nothing else, with no
   IP to bind, is the key model that fits a serverless function; and every position, fill and funding payment of any
   address can be read with no key, so the recorder proves the bot's book in a live phase without touching its key or
   session (§7.6). It also has the lowest fees (1.5 / 4.5 bps), hourly funding by a published formula (no 8-hour settlement
   to time round), stops triggered on a mark that is the median of the CEXs' own mids (a wick in one book does not fire
   it), isolated margin per asset and no liquidation fee. Its weaknesses are real and bounded: SOL's book is thinner (0.44M
   bid within 10 bps today; impact 0.49 bps at $10k), its public history is days, not years (so our recorder starts on day
   one), its testnet is thin, and its custody is a bridge and a validator set. It trades the three coins Grok would trade.
2. **Binance USDⓈ-M.** The deepest book, the venue whose price everyone else's mark follows (Hyperliquid weights it 3 of 9),
   the only free multi-year history (scoring studies, base rates), and Polymarket's crypto questions resolve on Binance's
   BTC/USDT spot candles. It ranks second for execution because a CEX trade key on a serverless function is weaker, its
   conditional orders moved to a separate Algo Service in December 2025 and are not attached to the entry, and a live
   recorder would need its own key. It is the **reference and history venue in every phase**, and the execution venue if
   Hyperliquid does not answer from eu-west-2.
3. **OKX.** Measured reachable from our Edge today, a stop attached to the entry with a mark trigger, demo trading on live
   prices; fees and history behind the first two.
4. **Bybit.** The highest taker fee (5.5 bps), not measured from any address we use, its own guide's 403 for some regions and
   a reported block on cloud ranges, and keys that expire unbound.

**Kraken** (the research's UK-facing route) costs about twenty times a perp round trip and is not ranked: Davies' accounts
make it unnecessary.

## 3. Claims in the research, checked

| claim (research §) | verdict | evidence |
|---|---|---|
| Trend rows: `trend-1h` 12 round trips −$47.69; `trend-4h` 4, −$11.86 (§4.1) | **confirmed** | read-only SQL on `agent_orders`, filled, net of fees: 12/12 −47.69; 4/4 −11.86 |
| GROKPM: shadow Brier 0.0019 vs last trade 0.0004 on 4; 0.136 vs 0.106 on 9 (§4.1) | confirmed | prereg D10, D7 |
| Power: d −0.124 / +0.076, mean −0.010, sd 0.099, ≈ 400 forecasts for t ≈ 2 (§4.4) | arithmetic **confirmed** (sd 0.2 × √(0.43 × 0.57) = 0.0990; (2 × 0.099 / 0.010)² = 392) | but it assumes independent forecasts; strikes of a day share one path, and three coins move together: §5.4 measures it with clustering |
| 225 trades for t = 2 at +0.2 R, sd 1.5 R (§4.4) | confirmed ((2 × 1.5 / 0.2)² = 225) | |
| Hyperliquid BTC 0.12 bps wide (§2.3) | confirmed (0.123 today) | `books.py` |
| Hyperliquid "$3.7M–$6.8M within 10 bps" (§2.3) | **wrong window**: 20 full-precision levels span 2.4–2.5 bps ($9.0M / $4.3M today); within 10 bps $26.4M / $27.9M | `books.py`, `l2Book` at full precision and at nSigFigs 4 |
| Hyperliquid fees 0.015 / 0.045; funding hourly, cap 4 %; 0.01 %/8 h interest; maintenance = half the initial margin at max leverage; no liquidation fee (§2.3) | confirmed | docs: fees, funding, liquidations (read today) |
| At 3× isolated, liquidation ~32 % from entry on BTC (§5.5) | confirmed (margin 33.3 % less maintenance 1.25 %, ≈ 32.1 %) | but see F8 |
| Binance funding every 8 h "(from memory)"; long carry "sign varies" (§2.3, §3) | 8 h confirmed for BTC/ETH/SOL (`predictedFundings`); the carry wording is misleading: Binance and Hyperliquid have the same 0.01 %/8 h interest term, so at a zero premium both charge longs ≈ 3 bps a day | |
| Hyperliquid stop on mark or last "not settled" (§7) | **settled: mark**, for TP/SL and liquidation | FAQ "my TP/SL did not execute correctly"; "robust price indices" |
| Polymarket daily "above ___" at 16:00 UTC (§5.12) | true until 10-31; **17:00 UTC from 11-01** (12:00 ET; US DST ends 11-01) | Gamma `endDate`: 10-31 16:00Z, 11-01 17:00Z |
| "Bitcoin above ___ on October 29?" 11 strikes, $390,774 in 24 h (§1) | in range (11 strikes, $402,198 at 00:20 UTC) | Gamma |
| Bybit, OKX excluded by their UK terms (§1, §2.6) | superseded: Davies holds international accounts that can short at both (2026-10-29), and eligibility is his call | |
| Phase 0 must pass before Phase 1 (§1, §6) | superseded: Davies starts Phase 1 now; the forecast layer runs inside it (§4) | |
| API wallets cannot withdraw (§2.3) | Hyperliquid's own page says only "only used to sign"; third-party SDK docs say no withdrawal. Unchanged: still to confirm on the testnet before Phase 2 | |

## 4. Phase 1: what it can prove, and what runs inside it

**What it is.** Paper brackets on Hyperliquid's live public tape, sized on a notional $1,000, every rule enforced by the
server, every fill by a conservative model (§7.3), with no key of any kind. **What it can show:** that the plumbing,
the rules and the journal work for weeks; how often Grok trades and why; whether the cost model is honest; and
calibration: does Grok's probability beat the bracket's own model-free m? **What it cannot show:** an edge in money. At
1–3 real brackets a day, 56 days give 60–170 trades against the ≈ 225 that +0.2 R needs at t = 2; and a paper fill is not a
fill (queue, latency, a crash's book).

**So three layers run from day one, on one clock** (the research's Phase 0 folded in):

| layer | what is scored | why |
|---|---|---|
| **A. Assigned brackets** (primary) | Every 4 hours (00, 04, …, 20 UTC) the server issues, for each of BTC, ETH and SOL, a long and a short bracket: stop 1 × the coin's one-day volatility, limit 2 × (so m = 1/3), held at most 72 h. Grok answers p for all six within 20 minutes; the brackets START at that deadline, re-centred on the mid then, so no answer sees its own bracket's first move. 36 a day, 2,016 in 56 days. A missing answer is counted | Grok cannot choose what is scored; the bracket is the trade Grok would make; both sides of every coin mean a directional bias shows up as one |
| **B. Polymarket's crypto prices** (secondary) | For each daily "Bitcoin above ___" and "Ethereum above ___" question, at 24 h, 8 h and 2 h before it resolves, the three strikes whose mid is nearest 0.25, 0.50 and 0.75 at issue; p within 15 minutes; scored against the mid AND the last trade at the deadline, and against the outcome | the one place the market prints a probability for the same question; GROKPM's lesson (mid vs last) kept |
| **C. Grok's own brackets** (real paper trades and shadows) | as IGBOT, but scored on continuous y (§5.1) and on the ORIGINAL bracket on the tape, whatever the position later did | the trading itself; money and discipline |

**Should a forecast layer run inside Phase 1?** Yes, and it is the part that can answer anything in 8 weeks: layers A and B
are hundreds of forecasts the forecaster did not pick, layer C is tens of trades it did.

## 5. Scoring that cannot be gamed

### 5.1 The outcome y and the baseline m

A bracket is a direction, an entry e, a stop s and a limit l, and a hold H. **y** is read on the recorded tape from the
bracket's start: 1 if the limit is reached first, 0 if the stop is, and if neither by H, **y = (x_H − s) / (l − s) for a
long, (s − x_H) / (s − l) for a short**, clipped to [0, 1], where x_H is the last trade price of the minute that ends at the
start + H. **m = (e − s) / (l − s)** (long; mirrored for a short). If the price is a martingale (the perp's price under
the market's own measure, to within funding, which is costed separately), optional stopping at min(first touch, H) gives
**E[y] = m exactly, for any hold, volatility or skew**: the baseline is the market's, model-free, and needs no implied
volatility. Brier on a y in [0, 1] stays proper for its mean. Checked by simulation (`bracket.py`, 200,000 paths):

| bracket (σ annual, hold) | P(limit first) | P(stop first) | neither by H | E[y \| neither] | E[y] (m) | P(limit first \| resolved) |
|---|---:|---:|---:|---:|---:|---:|
| −2.5 % / +5 % (30 %, 72 h) | 0.071 | 0.356 | 0.574 | 0.459 | 0.3340 (0.3333) | **0.166** |
| −3 % / +4.5 % (30 %, 24 h) | 0.005 | 0.054 | 0.941 | 0.420 | 0.4008 (0.4000) | **0.089** |
| −5 % / +10 % (45 %, 7 d) | 0.118 | 0.420 | 0.462 | 0.467 | 0.3338 (0.3333) | **0.220** |
| IG-like: −0.5 % / +1 % (16 %, 7 d) | 0.335 | 0.665 | 0.000 | — | 0.3347 (0.3333) | 0.335 |
| IG-like: −1 % / +2 % (16 %, 7 d) | 0.299 | 0.628 | 0.073 | 0.500 | 0.3355 (0.3333) | 0.323 |

The last column is what the excluded-if-unresolved rule scores against: on crypto it is half of m or less.

### 5.2 The false-pass test

`falsepass.py` simulates 42-day windows of three correlated coins (vol 40/55/70 %, correlation 0.75–0.8), 1,512 assigned-style
brackets each, for forecasters with NO skill, under two designs: **A**, IGBOT's draft (unresolved excluded, bootstrap of
brackets, one overall oracle shift; pass needs n ≥ 150, D > 0, the 5th percentile > 0, D_c > 0) and **B**, this audit's
(y at its fraction, a bootstrap of 3-day blocks, an oracle shift per coin and direction). Share of 300 windows that PASS:

| no-skill forecaster | 1 σ / 2 σ brackets: A | B | 1.5 σ / 3 σ: A | B |
|---|---:|---:|---:|---:|
| p = m ± 0.10 at random | 0.000 | 0.000 | 0.000 | 0.000 |
| "shader": p = P(limit first \| resolved), from the volatility alone | **0.257** | 0.000 | **0.320** | 0.000 |
| bull bias: long m + 0.10, short m − 0.05 | **0.200** | 0.000 | 0.047 | 0.000 |
| trend chaser: m ± 0.08 with or against the last 24 h | **0.083** | 0.000 | 0.027 | 0.000 |

(seeds 20261029 and 20261030; the shader's mean D under A is +0.0019 and +0.0271: it "beats" m on average without skill.)
On IG's own geometry the bias is small (−0.001 to −0.011), but IGBOT also excludes real brackets the agent closes, a way to
drop losers from the score: F11.

### 5.3 The bar (proposed; frozen with the prereg)

D = Brier(m) − Brier(p) (positive: Grok is better), on layer A's answered brackets: **D > 0; the 5th percentile of a
circular 3-day-block bootstrap (10,000 resamples, mulberry32 seeded 20261029) > 0; D_c > 0**, where D_c moves each
(coin, direction) cell's baseline by that cell's mean (y − m), the oracle that knew the window's drift; and at least 90 % of
issued brackets answered. An ambiguous minute (both levels inside one recorded minute) is resolved stop-first AND
limit-first: the bar must pass under both. Layer C must show D > 0 and D_c > 0 on at least 60 scored brackets, and paper
P&L > 0 after fees, slippage and funding, with the total stop never reached and no paper liquidation. Layer B is reported
(event-day clusters; against the mid, the last trade and Deribit's digital), not a bar.

### 5.4 Power (`power.py`)

A calibrated forecaster who knows each coin's drift over 3-day spells (common across coins, as a macro view is), with its
p the mean outcome of its own bucket:

| its mean \|p − m\| | mean D | 42 days | 56 days | 84 days |
|---:|---:|---:|---:|---:|
| ≈ 0.08 (α 0.3) | +0.007 | passes 0.29 | 0.20 | 0.34 |
| ≈ 0.13 (α 0.6) | +0.027 | 0.65 | 0.66 | 0.86 |
| ≈ 0.18 (α 1.0) | +0.056 | 0.89 | — | — |

(100 windows each; seeds 20261029, 20261031.) A small real skill will usually read "not shown"; a moderate one usually
passes in 8 weeks; a miss never says "no edge". The prereg runs 56 days with a futility look at day 28 (stop if the
bootstrap's 95th percentile of D is below 0), which can only end the test early, never pass it.

## 6. Data and probability sources for Grok, and what the server computes

### 6.1 The sources

| source | endpoint (keyless) | latency | good for | not good for |
|---|---|---|---|---|
| **Hyperliquid** (the venue) | `POST api.hyperliquid.xyz/info`: `metaAndAssetCtxs` (mark, oracle, mid, funding, premium, OI, impact prices), `l2Book`, `candleSnapshot`, `fundingHistory`, `predictedFundings` (Hyperliquid's, Binance's and Bybit's next funding in one call) | real time | the bracket's price, spread, depth, realised volatility (from our minute record), funding now and next, crowding (OI, premium) | history (3.5 days of minutes) |
| **Binance** | spot `api.binance.com/api/v3` (`bookTicker`, `klines`) from London; USDⓈ-M `fapi.binance.com` (`premiumIndex`, `openInterest`, `/futures/data/takerlongshortRatio`, `topLongShortPositionRatio`) once `reach` passes; archives `data.binance.vision` | real time; archives T+1 | **Polymarket's resolution price** (BTC/USDT spot candles); leverage crowding; years of minute data for base rates | — |
| **Deribit** | `www.deribit.com/api/v2/public/`: `get_index_price`, `get_volatility_index_data` (DVOL, 30-day), `get_book_summary_by_currency?kind=option` (mark IV per strike), `kind=future` (dated futures: the term basis) | real time | implied vol at the bracket's horizon; digital P(S_T > K) from the smile; touch probabilities; the move an event is priced to cause (forward variance between expiries); skew | SOL (BTC and ETH only); IV includes a variance premium, so its touch probabilities run high |
| **Polymarket** | Gamma `gamma-api.polymarket.com/events?tag_slug=bitcoin` (and `ethereum`), CLOB `/book`, data API trades | real time | market probabilities for "above K at noon ET", "price range", weekly and monthly "hit K" (touches) and hourly "up or down", resolved on Binance spot | depth: a few tens of thousands of dollars a strike |
| **Kalshi** | `api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXCPI` (and `KXFED`, `KXPAYROLLS`) | real time; rate-limited | market probabilities for the CPI print and the Fed decision: category E's input | crypto itself |
| **OKX** | `www.okx.com/api/v5/public/liquidation-orders`, `/public/open-interest`, `/rubik/stat/contracts/long-short-account-ratio`, `/public/opt-summary` | real time | liquidation flow (forced selling), a second OI and crowding read | — |
| **Coin Metrics community** | `community-api.coinmetrics.io/v4/timeseries/asset-metrics?metrics=FlowInExUSD,FlowOutExUSD` | daily, "flash" about 02:30 UTC next day | net exchange flows (context) | anything inside a day |
| **DefiLlama** | `stablecoins.llama.fi/stablecoincharts/all` | daily | stablecoin supply (liquidity context) | token unlocks (`api.llama.fi/emissions` answers 402: paid) |
| **The calendar** | `agents/cb_releases.ts` (CPI, NFP, FOMC, ECB, BoE to 2026-12-31) | frozen list | blackouts, E and R categories | anything after 12-31 (refused until extended) |
| **ETF flows, CME basis, news** | Farside (403 here), cmegroup.com (no answer here): Grok reads them itself; Deribit's dated futures stand in for the basis | T+1 for flows | narrative context | a feed the server can check |

### 6.2 What the server computes and hands Grok each wake (so Grok's p meets a defined market p)

`?action=quote` for any candidate bracket (and attached to every assigned question):

1. **m**, model-free (§5.1), from the mid at the start; and the exit side's m* (the bid for a long, the ask for a short;
   ≤ 1 bp apart on these books).
2. **Costs c**, in price: taker in (4.5 bps) unless resting, the exit's fee (maker 1.5 at the limit, taker 4.5 at the stop)
   plus stop slippage (5 bps, §7.3), and funding at the predicted rate for min(H, the expected time to exit); **p\* = m +
   c / (d_stop + d_limit)**; **the bar p\* + 0.08**.
3. **The decomposition under two volatilities**, the implied one at the horizon (Deribit's ATM IV interpolated in total
   variance; BTC, ETH) and the realised one (the last 7 days of our recorded hourly returns): P(limit first by H), P(stop
   first by H), P(neither), E[y | neither], by the double-barrier series, pinned in tests against `bracket.py`.
4. **Touch and level probabilities from other markets** near the bracket's levels: Polymarket's "hit K" and "above K"
   mids and last trades where K is within 0.5 % of a level; Deribit's digital P(S_H > K) and its touch estimate.
5. **Context numbers**: the implied move of the next listed release (forward variance between the expiries around it),
   funding now and predicted on three venues, OI change over 24 h, the premium, liquidations over the last hour, the
   Binance–Hyperliquid basis, realised vs implied vol.
6. **Sizing**: the risk at the stop, the ¼-Kelly cap, the leverage the server will set and the liquidation price it gives,
   and every rule the bracket would break, by name.

### 6.3 Worked examples (2026-10-29 00:20 UTC)

- **A bracket.** BTC long at 81,200, stop 79,170 (−2.5 %), limit 85,260 (+5 %), hold 72 h. **m = 0.333.** Costs: taker in 4.5,
  taker stop or maker limit (take the stop: 4.5 + 5 slippage), funding 3 days at 2.2 bps a day ≈ 6.5: c ≈ 20.5 bps, c /
  (d_stop + d_limit) = 20.5 / 750 = 0.027, **p\* = 0.361, bar 0.441**. Under Deribit's 3-day IV (≈ 30 %): limit first 0.071,
  stop first 0.356, neither 0.574 at E[y | neither] 0.459: E[y] = 0.071 + 0.574 × 0.459 = 0.334 = m. To trade it, Grok must
  expect y ≈ 0.44: for instance limit first 0.17, stop first 0.25 and the rest timing out above the middle; the server
  shows these numbers and Grok must say which of them it disagrees with, and why.
- **A Polymarket question.** "Bitcoin above 82,000 on October 30?" (resolves 10-30 16:00 UTC on Binance BTC/USDT's 1-minute
  close): Polymarket bid 0.34, ask 0.35, last 0.34. Deribit's digital at that instant: 0.291 on its USD index (F 81,203); the
  USDT price stood 0.11 % higher (Binance 81,268 against the index 81,179), which moves it to about 0.31. 84,000: Polymarket
  0.075, Deribit 0.048; 80,000: 0.775 against 0.791. Grok's p is scored against Polymarket's mid and last; Deribit is shown.
- **Touches.** "Hit 84,000 by Nov 1 (ET)": Polymarket 0.285, Deribit's driftless reflection 0.334; 86,000: 0.085 against 0.130;
  "dip to 78,000": 0.185 against 0.254. Deribit runs 5–7 points higher on every one: implied vol over realised. Which is
  better calibrated is an empirical question layer B answers; neither is the scored baseline.
- **An event's implied move.** ATM IV for Nov 1 08:00 (3.32 days) 27.0 %, for Nov 6 08:00 (8.32 days) 37.0 %: the forward
  vol between them is √((0.370² × 8.32 − 0.270² × 3.32) / 5.00) = 42.4 %, a day's sd of 2.2 % against 1.4 % before; the US
  midterm elections (11-03) and payrolls (11-06) sit in that span.

## 7. The architecture, corrected

### 7.1 Shape and modes

As the research's §5.1, with these changes: `cxbot_config.mode` is `check (mode in ('dry_run', 'paper'))` in Phase 1 (no
`testnet`, no `live`); `client.ts` allows only public read hosts (the §6.1 list) and refuses everything else before `fetch`,
with **no signing code at all in Phase 1**; the function runs in eu-west-2 by default and is never forced to a region to
reach a venue. Calls (bearer `CXBOT_TOKEN` for the agent; the cron bearer for the minute): `ping`, `account`, `markets`,
`context`, `quote`, `questions`, `forecast`, `order`, `close`, `amend`, `cancel`, `cancel_all`, the journal POST,
`calendar`; cron only: `record` (every minute), `sync` (every minute: the paper engine, issuing and resolving questions,
funding), `reach` (on demand); `rec` (keyless, read-only, for TESTING).

### 7.2 CXBOT_RULES (pure, each pinned alone)

| rule | value | change from the research, and why |
|---|---|---|
| instruments | BTC, ETH, SOL perps; no ETH/BTC pair in Phase 1 | the pair adds a second leg's fills and a second stop for no scored gain yet |
| bracket | stop and limit on every open; reward ≥ 1.5 × risk; **stop distance 0.75–5 × the coin's one-day volatility** (served by `markets`), and ≥ 1 % | percentages ignore that SOL moves 1.75× BTC |
| edge | p ≥ p\* + 0.08, p\* from the server's costs (§6.2) | as researched, the costs the server's |
| risk | ≤ 1 % of $1,000 at the stop, costs included, and ≤ ¼ Kelly of the paper equity at p, R | — |
| total and same-direction risk | ≤ 3 % at the stops in all; **≤ 2 % in one direction** | BTC/ETH/SOL correlate 0.75–0.8: three longs are one bet |
| positions | ≤ 3, one per coin: no adding, averaging down or hedging | — |
| notional | gross ≤ 2 × budget, net ≤ 1 × | — |
| leverage | **the server sets it**: the least of 3× and the leverage at which the liquidation price (Hyperliquid's rule, paper) lies ≥ 2.5 stop distances beyond the stop; isolated | the research's two rules contradicted each other at a 10 % stop |
| funding | no open whose side pays more than 0.01 %/h on the current OR the predicted rate; a position paying that for 6 h is flagged | — |
| blackout | no open from T−10 to T+5 min of a listed release; none while the tape is older than 2 minutes or the spread wider than 5 bps (BTC, ETH) / 10 bps (SOL) | — |
| order shapes | `market` (IOC at a worst price ≤ the touch ± 0.1 × the stop distance), `limit` (rests, 5 min–24 h, post-only), `stop` entry (5 min–24 h) | — |
| hold | the server closes any position at 7 days | — |
| categories | E (a listed release within 72 h), R (one within 24 h behind), N (a thesis), C (changes); every open ≥ 1 source and an invalidation | — |
| stops | day −2 % ($20): no open until 00:00 UTC; total −10 % ($100): close-only, the test FAILS; both latched | — |
| request rate | ≤ 3 trading requests a minute, ≤ 30 orders a UTC day, ≤ 600 requests an hour, 300 journal rows an hour; `forecast` answers do not count against orders | — |
| amend | a stop may only tighten; a limit stays on the profit side | — |
| calendar | no open after 2026-12-31 until the list is extended | IGBOT's audit rule |
| gates | global pause; mode; the tape fresh; the paper equity read | — |

### 7.3 The paper fill model (conservative by construction)

- **A market entry** fills at the recorded touch of the minute the request lands (the ask for a buy), plus the impact of its
  size through the recorded depth, plus one tick; taker 4.5 bps. Refused if the worst price would be passed.
- **A resting limit** fills only when a LATER minute's trades go strictly through its price (`tradedThrough`, reference
  §3.26); maker 1.5 bps; all or nothing at our size.
- **The stop** triggers on the minute's trade low (long) or high (short), which wicks past the mark more often than the mark
  does (conservative); it fills at the worse of the stop less 5 bps and the next minute's open; taker 4.5 bps.
- **The limit (take-profit)** fills only when trades go strictly through it; maker 1.5 bps.
- **Funding** hourly at Hyperliquid's recorded rate on the notional at the oracle price; a long pays a positive rate.
- **A gap in the record** (minutes the recorder missed) resolves at the first recorded minute's open; a stop in a gap fills
  there.
- **Liquidation** at Hyperliquid's isolated rule; a paper liquidation is an incident (the rules should make it impossible).
- The agent never supplies a price, a fill or an outcome.

### 7.4 The recorder and the tables

`record`, every minute, beat first, `retry` true (upserts by minute): `metaAndAssetCtxs` (weight 20), `l2Book` × 3 (2 each),
`candleSnapshot` 1m for the last 3 minutes × 3 (≈ 20 each): about 90 of the 1,200 a minute per IP. Supabase's egress IPs
are shared with other projects, so a 429 is expected sometimes: back off, record the minute as missing, never retry within
it. Every 5 minutes (`sync`): Deribit (index, DVOL, the smile compressed to ATM, 25-delta and ±5 % strikes per expiry, the
dated futures), Polymarket's assigned questions (book, mid, last), Binance spot `bookTicker`. Hourly: `predictedFundings`,
OKX liquidations, Kalshi on release days. Daily: Coin Metrics flows, DefiLlama stablecoins. Tables: `cxbot_config`,
`cxbot_instruments`, `cxbot_tape` (minute rows per coin), `cxbot_ctx` (5-minute and slower context, JSON), `cxbot_questions`
(issued: kind, geometry or Polymarket market, issue and deadline, the server's m, costs and decomposition), `cxbot_forecasts`
(answers), `cxbot_decisions`, `cxbot_orders`, `cxbot_positions`, `cxbot_fills`, `cxbot_funding`, `cxbot_snapshots`,
`cxbot_outcomes` (every question's and bracket's y, written by `sync`), `cxbot_cycles`, `cxbot_daily`, `cxbot_requests`,
`cxbot_exec_state`; RLS on, no grant, no policy. The tape is pruned after 120 days, never before the reading has run.

### 7.5 TESTING, the desk ledger, the monitor

- **TESTING**: one row, "Crypto analyst" (Davies names it), on a Hyperliquid card marked PAPER: funded $1,000 (Paper), P&L,
  positions, and the reading's live figures (answered share, D on layer A with its n). It reads `cxbot?action=rec`
  (keyless, as `grokpmrec`). The page, `docs/guide.md` and `docs/map.md` change with it.
- **The desk ledger**: `CXBOT_LEDGER.md`, alone on the branch `cxbot-ledger` (no CI, no deploy, never merged), seeded from
  `docs/agents/cxbot/ledger_seed.md` (written with this audit). ≤ 10,240 bytes; Status overwritten; "Claude → Grok"
  requests and "Grok → Claude" replies; a 20-line log. Grok reads it at every full scan and event wake and writes only
  there; Claude runs a daily desk check (the main session schedules it).
- **The monitor**: Phase 1 holds no money, so it joins `edge_calls` and the watchdog, not `monitor/health.ts`; a live phase
  adds it there.

### 7.6 Sessions and keys (IG's lesson)

Phase 1 holds no key and no session: public reads only. In a later phase on Hyperliquid, the bot signs with an API wallet
and the recorder reads the bot's address (`clearinghouseState`, `userFills`, `userFunding`) with no key at all: they share
nothing. On a CEX, the recorder gets its own read-only key and the bot its own trade key, in separate secrets, never one
key for both (one login may not tolerate two sessions, and a key's nonce or rate budget would be shared).

### 7.7 The wake cadence, derived for 24/7

IGBOT's audit found that more wakes do not help judgement about events; crypto trading round the clock does not change
that: Grok is never first to news, and between wakes the stops rest in the paper engine (in a live phase, on the venue).
What 24/7 changes is that there is no closed market to wait for, so the clock is set by the questions and the holdings:

| wake | when (UTC) | what |
|---|---|---|
| full scan | 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 (questions issued at :00, answers due :20) | the desk ledger; `account`, `markets`, `context`, `questions`; the six assigned brackets answered first, p before reading the server's decomposition; research; own candidates to a number through `quote` (open if it clears, a shadow if not); Status |
| Polymarket wakes | 24 h, 8 h and 2 h before each daily question (16:00 UTC to 10-31, 17:00 from 11-01) | the assigned strikes, p before reading their prices |
| event wakes | T−60, T−20, T+5, T+15, T+60 of each listed CPI, NFP, FOMC | as IGBOT: E decided by T−20 (none from T−10), R from T+15 |
| holding check | every 30 minutes while anything is open or resting | `account` only: close a broken thesis, tighten, cancel; no new open |
| daily | after 00:00 | the daily row |

About 12–20 wakes a day. Spend tokens on depth (sources, the decomposition, shadows), not on frequency.

### 7.8 What the prompt must hold

The bar and the base rates; the server's calls and **every answer with what to do** (IGBOT's table); **every refusal by its
rule name**; the data and probability sources (§6) and the order of reading (p first, then the server's numbers); how to
size; assigned questions and their deadlines; the journal; the rhythm; the desk ledger protocol; the never-list.
**Examples are validated by tests** against the server's own validation (as IGBOT's `examples.json`): the draft's are not
yet, and the build adds them.

## 8. Who does what

- **Davies, for Phase 1**: one secret, `CXBOT_TOKEN` (32+ random characters, given only to Grok); the bot's name; the word
  that starts the paper run (it freezes the prereg). **No exchange key, no testnet key, no wallet.**
- **The main session**: verify this audit; build (`reach` first; then the recorder; then the paper engine and the
  agent's calls), with Deno pins for every rule and the scorer pinned in vitest; create `cxbot-ledger` from the seed;
  schedule the daily desk check; land the TESTING row.
- **Later (Phase 2, a new prereg on his word)**: the testnet rehearsal (a testnet API wallet), then a fresh wallet funded
  with the budget alone, a named API wallet's key as the only secret, and the monitor.

## 9. Not checked

- Reachability of Hyperliquid, Binance's futures API and Bybit from eu-west-2 (the build's `reach`).
- Bybit's and Binance's live books (both refuse this container); Bybit's and OKX's fees from their own pages (dynamic pages;
  secondary sources used); Binance's clearance-fee rates; OKX's and Bybit's key-expiry rules (from memory).
- Hyperliquid's TP/SL grouping with the entry and the API wallet's withdrawal limit, on the testnet (Phase 2).
- Kalshi's CPI release time (rate-limited); the BLS dates in `cb_releases.ts` remain unconfirmed.
- Whether Davies' accounts may trade each product (his decision); tax.
- The power study's skill model is one model of skill (a drift known over 3-day spells); a different kind of skill has a
  different power.

## Sources (read 2026-10-29 unless stated)

- Hyperliquid docs: fees https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees ; funding …/trading/funding ;
  liquidations …/trading/liquidations ; robust price indices …/trading/robust-price-indices ; TP/SL FAQ
  …/support/faq/trade-outcome-looks-incorrect/my-tp-sl-did-not-execute-correctly ; rate limits
  …/for-developers/api/rate-limits-and-user-limits ; API wallets …/for-developers/api/nonces-and-api-wallets
- Measured (keyless): `api.hyperliquid.xyz/info` (`l2Book`, `metaAndAssetCtxs`, `candleSnapshot`, `fundingHistory`,
  `predictedFundings`); `www.okx.com/api/v5/public/instruments`, `/market/books`, `/public/liquidation-orders`;
  `data.binance.vision/data/futures/um/daily/{bookDepth,metrics,aggTrades}/…-2026-10-27.zip`; `data-api.binance.vision/api/v3/ticker/bookTicker`;
  `public.bybit.com/trading/BTCUSDT/`; Deribit `get_index_price`, `get_volatility_index_data`, `get_book_summary_by_currency`,
  `get_instruments`; Polymarket Gamma `events?tag_slug=bitcoin`, `events?slug=bitcoin-above-on-october-30-2026`,
  `…what-price-will-bitcoin-hit-october-26-november-1-2026`; CoinGecko `api/v3/derivatives`; Coin Metrics community;
  DefiLlama; Kalshi `events?series_ticker=KXCPI`; production (read-only SQL): `okx_books`, `agent_orders`, `edge_calls`
- Binance: futures fee FAQ https://www.binance.com/support/faq/360033544231 (via search); New Algo Order
  https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Algo-Order ; the migration's
  error −4120 https://github.com/nautechsystems/nautilus_trader/issues/3287 ; clearance fee
  https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554
- Bybit: v5 create order https://bybit-exchange.github.io/docs/v5/order/create-order ; v5 guide (403 for US and mainland
  China IPs) https://bybit-exchange.github.io/docs/v5/guide ; fees https://bybit.nl/en-NL/help-center/article/Perpetual-Futures-Contract-Fees-Explained ;
  cloud ranges (vendor claim) https://quotaguard.com/blog/bybit-api-403-cloud-platform-cdn-block-fix
- OKX fees (secondary): https://okx-api.aperture.finance/help/fee-details ; attached algo orders (SDK docs)
  https://deepwiki.com/tiagosiebler/okx-api/2.2-trading-endpoints
- This repository: `reviews/2026-10-29-crypto-grok-bot-research.md`, `reviews/2026-10-29-igbot-research.md`,
  `reviews/2026-10-29-igbot-prereg.md`, `docs/agents/igbot/GROK_PROMPT.md`, `docs/agents/backtests/igbot/score.mjs`,
  `reviews/2026-10-15-grokpm-prereg.md`; scripts `docs/agents/backtests/cxbot/{books,implied,bracket,falsepass,power}.py`
