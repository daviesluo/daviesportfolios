# Agents — reference: TypeSafe Jev 1.13 and the Revolut X API

Everything below was verified against primary sources or measured live on
2026-09-20. Nothing here is from memory: Jev was released on 2026-09-17/18
and is not in any model's training data. Re-verify anything marked
*measured* before relying on it later — spreads, volumes and history depth
move.

Read this before touching anything under the agents feature. The design
consequences at the end are the part that matters; the tables are the
evidence for them.

## 1. TypeSafe: Jev 1.13 — what it is

A **System One model**: it does not generate text. It takes an application
*state* plus a map of typed *questions* and returns typed answers with
probabilities. "Unstructured state in, typed probabilistic decisions out."
It cannot emit a value outside the schema you declare, which is why the
vendor quotes a 0 % structured-output error rate.

| Fact | Value | Source |
|---|---|---|
| Versions | `jev-1.13.0`; aliases `jev-latest` and `jev-preview` both → 1.13.0 today | docs.typesafe.ai/models |
| Modality (OpenRouter) | `text->decisions` | openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints |
| Context | 64k tokens per request, of which 32k for state + longest question (native); OpenRouter lists 32k | docs; OpenRouter endpoints JSON |
| Price | **$0.042 per million input tokens, output free** ($0.000042 per 1,000-token call) | docs; OpenRouter `pricing.prompt = 0.000000042` |
| Latency | 70–500 ms end to end | typesafe.ai blog |
| Rate limits (native) | 250,000 tokens/s; 1,200 requests/min | docs.typesafe.ai/models |
| Input | text only — string, JSON object, or array; no images | docs concepts/state |
| Language | English primary; others accepted, lower accuracy | docs |
| Streaming | none | LiteLLM pass-through docs |

### 1.1 Native endpoint (TypeSafe)

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

Request:

```json
{
  "model": "jev-latest",
  "state": { "any": "text, object or array" },
  "questions": {
    "enter":  { "type": "noul",   "instructions": "…", "criteria": { "true": "…", "false": "…" } },
    "regime": { "type": "choice", "instructions": "…", "criteria": { "trend_up": "…", "range": null, "trend_down": "…" } },
    "risk":   { "type": "score",  "instructions": "…", "criteria": ["calm", "elevated", "extreme"] }
  }
}
```

- `noul` — yes/no. `criteria` is optional natively. Answer `{ "type": "noul", "noul": 0.93 }` — the probability of *yes*. **Noul answers carry no `confidence` field.**
- `choice` — pick one of ≤ 255 options. `criteria` is required; descriptions may be `null`. Answer `{ "type": "choice", "choice": "trend_up", "probabilities": {…}, "confidence": 0.81 }`.
- `score` — ordered rubric of 2–10 levels. Answer `{ "type": "score", "score": 1.05, "legend": {"0": "calm", …}, "probabilities": {"0": 0.0, "1": 0.95, "2": 0.05}, "confidence": 0.92 }`. `score` is the probability-weighted position, so it can be fractional.
- Response envelope: `{ "model": "jev-1.13.0", "answers": { … }, "usage": { "input_tokens", "output_tokens" } }`.
- Errors: 401 bad key; 422 body failed validation; 429 rate limit; 529 overloaded. The SDKs retry 429/529 by default.

Unauthenticated probe today: `403 {"detail":{"error_type":"authentication_error","message":"Must supply an API key! …"}}` — the path is live.

### 1.2 Through OpenRouter (what the site will use first; TypeSafe direct is the fallback)

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
```

Same `{ model, state, questions }` body. Differences from native (from the
`oh-my-pi` and `typia` integration threads, to be confirmed live with the key):

| | TypeSafe native | OpenRouter Decisions |
|---|---|---|
| Path | `/v1/systemone` | `/api/alpha/decisions` (no `/v1`; chat SDKs do not work) |
| Model id | `jev-latest` / `jev-1.13.0` | `typesafe/jev-1.13` or `typesafe/jev-latest` |
| `noul.criteria` | both keys optional | when present, **both `true` and `false` required** |
| Response | `{model, answers, usage}` | superset: adds `id`, `provider`, `usage.cost` |

Unauthenticated probe today: `401 {"error":{"message":"No cookie auth credentials found","code":401}}`. Listed on OpenRouter 2026-09-18, marked alpha/beta. The OpenRouter Go SDK documents error statuses 400, 401, 402 (credits), 403, 404, 413, 429, 500, 502, 503, 524, 529.

### 1.3 Confidence — how to read it

- `choice`/`score` confidence is derived from the probability distribution, roughly `(count × peak − 1) / (count − 1)`: 1.0 when one option takes everything, 0 when flat. TypeSafe's guidance: **> 0.9 act automatically for high-stakes actions; 0.5–0.9 flag for review; < 0.5 fall back.** "Different actions within the same system should be gated at different levels depending on the consequences of getting it wrong."
- The full `probabilities` map is always returned, so a stricter custom rule is possible.
- There is **no structural guarantee** that P(yes) from one noul and P(no) from a separately-asked negation sum to 1, and thresholds do not transfer between noul and choice.

### 1.4 Jaggedness (vendor-documented weaknesses) — the ones that decide our design

From docs.typesafe.ai/model-jaggedness/jev-1.13:

1. **Numeric reasoning is unreliable.** It cannot reliably count, judge proximity between numbers, or calibrate a score numerically.
2. **Dates are read as text**, not ordered quantities: it cannot tell which of two dates is earlier or whether one falls in a window.
3. Literal reading — it answers the question written, not the one meant; boundary cases must be spelled out.
4. Large irrelevant state degrades accuracy.
5. Treats input as non-hostile; can be steered by injected text.
6. "Do not use it for tasks code can compute exactly."

**Consequence:** Jev must never be handed raw prices, candles, or timestamps and asked whether the market will go up. That is precisely items 1, 2 and 6. Code computes every number (indicators, regime flags, position, P&L, risk budget) and hands Jev a short *categorical* state; Jev answers typed questions about that state; a deterministic risk layer that Jev cannot override decides what is actually allowed. Jev is a fast, cheap, calibrated classifier inside a rulebook — it is not the source of the edge.

### 1.5 SDKs and real integrations

- Official JS SDK `@typesafe-ai/sdk` 0.6.0 — ESM, **zero dependencies**, Node ≥ 20, requires `globalThis.fetch`. `new TypeSafeClient({ apiKey })`, `client.systemOne({ state, questions })`, helpers `noul()`, `choice()`, `score()` produce the wire shapes above. Retries 429/529 with backoff, honours `Retry-After`. Types in `src/types.ts` match §1.1 exactly. The wire format is small enough that the Edge Function will hand-roll `fetch` rather than add an npm dependency (keeps `deno test` dependency-free).
- Pydantic AI (`typesafe:jev-latest`), LiteLLM pass-through (`/typesafe/v1/systemone`), `prismhq/jev-router` (a LiteLLM model router: builds a `choice` question over candidate models, reads `answers.model.choice`, 5 s timeout, falls back to a default on any non-200 or invalid choice — a good template for "fallback is a named default, never an exception").
- OpenRouter's Jev Lab recipes show the cost scale: 96 answers in 0.5 s for $0.0004; 475 answers in 1.2 s for $0.0014.

## 2. Revolut X — the exchange

| Fact | Value | Source |
|---|---|---|
| Base URL | `https://revx.revolut.com/api/1.0` (public market data also under `/1.0/public/…`; order book under `/2.0/public/…`) | developer.revolut.com/docs/x-api |
| Auth | Ed25519. Headers `X-Revx-API-Key` (64 chars), `X-Revx-Timestamp` (epoch ms), `X-Revx-Signature` (base64 Ed25519 over `timestamp + METHOD + path-from-/api + query + minified-body`, no separators) | docs; official `revolut-x-api-for-llm.md` |
| Key permissions | **read-only** or **full trading**; per-key IP allowlist; editable/deactivatable in the web app | help.revolut.com |
| Key scope | **"Each API key directly maps to the user account."** No sub-account scoping in the API. | docs/x-api/authentication |
| Fees | **0 % maker, 0.09 % taker**, flat, no tiers | revolut.com/legal/crypto-exchange-fees |
| Order types | `market`, `limit` (with `post_only` / `allow_taker`, `time_in_force` gtc/ioc/fok), `conditional`, `tpsl` | docs |
| Place order | `POST /1.0/orders` `{ client_order_id (uuid), symbol "BTC-USD", side, order_configuration: { limit: { base_size \| quote_size, price, execution_instructions, time_in_force } \| market: { base_size \| quote_size } } }` → `{ data: [{ venue_order_id, client_order_id, state }] }` | docs/x-api/place-order |
| Rate limits | Token buckets, **per endpoint**, verbatim from each endpoint's table on developer.revolut.com. `POST /1.0/orders` (place order): *Per-second limit 10 — 10 tokens/second — 1 token/request* AND *Per-day limit 1,000 — 1,000 tokens/day — 1 token/request*. Other authenticated endpoints: 100 tokens/s + 1,000 tokens/minute (the general “1,000 requests per minute” rule in the LLM reference). Public endpoints: 1 token/second. Authenticated candles: 500,000 tokens/s, cost `min(5,000, candle count)`. Historical queries cost 1 token per day in the requested range. 429 carries `Retry-After` in milliseconds. The day bucket refills continuously at 1,000/day rather than resetting at midnight, so it is a sustained-throughput cap of **1,000 orders per 24 h**, not a midnight lock — the constraint on the design is the same. | docs (literal table, checked 2026-09-20) |
| Money values | strings, never floats | docs |
| Symbols | dash in paths/requests (`BTC-USD`), slash in responses (`BTC/USD`) | docs |
| Cancel | `DELETE /1.0/orders/{venue_order_id}` → 204; `DELETE /1.0/orders` cancels all | docs |
| Fills | `GET /1.0/orders/fills/{venue_order_id}`; `GET /1.0/trades/private/{symbol}` (cursor, ≤ 1-week range) | docs |
| Balances | `GET /1.0/balances` → `[{ currency, available, reserved, total, staked? }]` | docs |
| Candles | `GET /1.0/public/candles/{symbol}?interval=<MINUTES>&since=<ms>&until=<ms>`; intervals `1,5,15,30,60,240,1440,2880,5760,10080,20160,40320`; **≤ 1,000 candles per call**; `{ start, open, high, low, close, volume }` | docs; *measured* |
| Errors | `{ error_id, message, timestamp }`; 400/401/403/404/409/429 (+ `Retry-After` ms)/5xx | docs |
| Sandbox | none for Revolut X (the Business sandbox is a different product) | docs |
| Deno | Ed25519 sign/verify works natively via `crypto.subtle` (checked on Deno 2.9.6, the 48-byte pkcs8 DER an OpenSSL PEM decodes to imports directly) — no npm needed | *measured* |

Official repo `revolut-engineering/revolut-x-api`: typed zero-dependency Node client (`api/`), a CLI (`cli/`), an MCP server and Claude skills; contains a *grid-strategy backtester*. No paper mode.

### 2.1 Pair configuration (live, `GET /1.0/public/configuration/pairs`, 456 pairs)

| Pair | base_step | quote_step | min size | min notional | max size |
|---|---|---|---|---|---|
| BTC/USD | 0.00000001 | 0.01 | 0.00000001 | **$0.10** | 200 |
| ETH/USD | 0.00000001 | 0.01 | 0.00000001 | $0.10 | 5,000 |
| SOL/USD | 0.000001 | 0.001 | 0.000001 | $0.10 | 20,000 |

A $100 account clears every minimum by three orders of magnitude; sizing is not a constraint.

### 2.2 Liquidity on Revolut X (*measured 2026-09-20 03:05 UTC, a Sunday night*)

| Pair | bid / ask | spread | 24h quote volume | 24h % |
|---|---|---|---|---|
| BTC/USD (UK) | 80,422.74 / 80,435.11 | **1.5 bps** | $1.47 M (EEA book $4.95 M) | −1.3 |
| ETH/USD (UK) | 2,579.43 / 2,579.96 | **2.1 bps** | $0.72 M (EEA $7.07 M) | −1.8 |
| SOL/USD (UK) | 108.15 / 108.18 | **3.1 bps** | $0.59 M (EEA $3.76 M) | −5.5 |
| XRP/USD | | 5.8 bps | $3.9 M | |
| BNB / ADA / LINK / AVAX / LTC / DOGE | | 7–12 bps | thin | |

Two books exist per pair (`region: UK` / `EEA`); which one an account trades on is decided by the account, not the request. Only BTC, ETH and SOL have spreads in the low single-digit bps; everything else costs 3–8× more per round trip before fees.

**The request has to name the region, though — found 2026-09-21 01:48 UTC.**
`/public/tickers` without `region` returns BOTH rows per symbol in
arbitrary order, and `/public/candles` without it is the EEA book's
series. That minute: UK SOL/USD 112.180 / 112.181 (0.1 bps), EEA 111.865
/ 112.371 (45 bps); UK BTC 6 bps, EEA 23; UK ETH 0.0, EEA 63; XRP 15.5
against 137. The client had kept whichever ticker row came last, so every
Revolut X quote the loop read before that night — marks, stops,
`agent_basis`, the one entry of §3.5 — was one book or the other at
random, and its paper fills were checked against EEA minutes. Since then
every market-data call carries `region=UK` (`REVX_REGION`), a row from
another region is dropped (`quotesForRegion`), and the probe reports the
region and the filtered rows with their spreads. The spreads in this
section came from whichever row the API returned last at the time:
re-measure on the UK book before quoting them again. The 1-minute study
of §3.5 read region-less candles, i.e. the EEA book — one more reason its
"cheap prints" were never this account's.

### 2.3 History depth on Revolut X (*measured*)

Daily candles paginate back to **2023-08-19 (BTC), 2023-09-05 (ETH), 2023-09-11 (SOL)** — three years, at ~1,000 candles per call. Hourly is available for the same span (≈ 41 days per call). One-minute candles exist. Enough for a venue-accurate backtest of anything at 1h or slower; older or denser history needs another source.

### 2.4 Keyless history sources reachable from the Edge/CI network

| Source | Reachable | Depth | Page |
|---|---|---|---|
| Coinbase Exchange `api.exchange.coinbase.com/products/{P}/candles` | yes | ETH-USD from 2016-06, SOL-USD from 2021-06, BTC earlier | 300 candles |
| Binance mirror `data-api.binance.vision/api/v3/klines` | yes | BTCUSDT from 2017-08 | 1,000 |
| `api.binance.com` | **no — HTTP 451 geo-block** | | |
| Kraken `api.kraken.com/0/public/OHLC` | yes | last 720 bars only | |

Two years of hourly BTC/ETH/SOL (17,511 bars each, 2 gaps) were pulled from Coinbase in 20 s per asset for the measurements below.

## 2b. Kraken (Kraken Pro) — the second exchange

Davies added a Kraken key pair to the secrets store on 2026-09-20
(`KRAKEN_PRO_API_KEY`, `KRAKEN_PRO_PRIVATE_KEY`); trading permission, no
funds yet. Everything below was read from Kraken's own pages or measured
against the live API the same day; the account-specific facts come from the
read-only probe in §6.

| Fact | Value | Source |
|---|---|---|
| Base URL | `https://api.kraken.com`, API version `0`: public `GET /0/public/<Method>`, private `POST /0/private/<Method>` | docs.kraken.com (spot REST intro) |
| Auth | Headers `API-Key` and `API-Sign`; body form-encoded with `nonce` first. `API-Sign = base64( HMAC-SHA512( key = base64-decoded secret, message = path + SHA256(nonce + body) ) )`, path from `/0/private`. The documented test vector reproduces byte for byte — pinned in `supabase/functions/agents/kraken.test.ts`. | spot REST auth page |
| Nonce | "always increasing, unsigned 64-bit integer for each request", per key; optional nonce window; repeated bad nonces → temporary ban. We send microseconds, monotonic inside an isolate. | spot REST auth page |
| Envelope | `{ error: [], result: {…} }` with HTTP 200 even for a refused request; errors are `E<Category>:<description>` (`EGeneral`, `EAPI`, `EOrder`, `EService`, `EQuery`, `EFunding`…) | spot REST intro |
| Naming | Requests take the pair's `altname` (`XBTUSD`, `ETHUSD`, `SOLUSD`); responses are keyed by the primary id (`XXBTZUSD`, `XETHZUSD`, `SOLUSD`); balances by asset code (`XXBT`, `XETH`, `SOL`, `ZUSD`, `ZGBP`, `USDC`). `kraken.ts` translates both ways at the wire. | AssetPairs, *measured* |
| Pair limits | XBT/USD: tick 0.1, lot 8 dp, `ordermin` 0.00005 BTC, `costmin` $0.5. ETH/USD: tick 0.01, `ordermin` 0.001. SOL/USD: tick 0.01, `ordermin` 0.06. `fees`/`fees_maker` arrays in AssetPairs are now EMPTY — the schedule comes from TradeVolume. | `GET /0/public/AssetPairs`, *measured 2026-09-20* |
| Fees — this account | **maker 0.40 % / taker 0.80 %** on all three pairs (`TradeVolume` with `fee-info`, live): tier 1 of the published table; next tier 0.30 / 0.60 at $2,500 of 30-day volume; maker reaches 0 % only at $10M. Revolut X is 0 / 0.09 with no tiers. | `POST /0/private/TradeVolume` *measured*; kraken.com/features/fee-schedule |
| Spread & depth | BTC 0.01 bps, ETH 0.04 bps, SOL 0.92 bps (Revolut X: 1.5 / 2.1 / 3.1). Resting within 5 bps of mid: BTC ≈ $2.5M ask / $2.3M bid, ETH $1.5M / $0.6M, SOL $36k / $52k. 24 h volume BTC 1,562 (≈ $126M), ETH 28.2k (≈ $73M), SOL 567k (≈ $62M). | `Ticker`, `Depth`, *measured 2026-09-20 03:55 UTC* |
| Candles | `GET /0/public/OHLC?pair=&interval=<minutes>` — intervals 1,5,15,30,60,240,1440,10080,21600; rows `[time_s, open, high, low, close, vwap, volume, count]`, last row is the open candle, `last` = start of the last closed one. **"Returns up to 720 of the most recent entries (older data cannot be retrieved, regardless of the value of `since`)"** — 120 days of 4h, ~2 years of daily. | get-ohlc-data, *measured* |
| Full history | Quarterly OHLCVT CSV bundle, every pair from its first trade to 2026-06-30, intervals 1/5/15/60/240/720/1440, free (`assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip.part00-04`); `GET /0/public/Trades` pages 1,000 trades a call. The best backtest data of the three venues we can reach. | support.kraken.com OHLCVT article; get-recent-trades |
| Orders | `AddOrder` — `pair`, `type` buy/sell, `ordertype=limit`, `volume` (base), `price`, `oflags=post` (post-only), `timeinforce` GTC/IOC/GTD/FOK, `cl_ord_id` (UUID or ≤ 18 chars, unique per open order), **`validate=true` — "the order will be validated only, it will not trade in the matching engine"**; reply `{ descr: { order }, txid?: [...] }` (no `txid` when validating). `CancelOrder {txid}`; `QueryOrders {txid}` → `status` pending/open/closed/canceled/expired, `vol`, `vol_exec`, `cost`, `fee` (quote), `price` (average); `OpenOrders`; `AmendOrder`. Permission needed: "Orders and trades – Create & modify orders". | add-order, get-orders-info |
| Rate limits | REST call counter 15 (Starter) / 20 (Intermediate, Pro), decaying 0.33 / 0.5 / 1 per second; ledger and trade-history calls cost 2, AddOrder and CancelOrder are on a separate limiter (`EAPI:Rate limit exceeded`). Matching-engine counter per pair 60 / 125 / 180, decaying 1 / 2.34 / 3.75 per second; AddOrder +1, a cancel costs up to +8 when the order is younger than 5 s and +1 under 300 s (`EOrder:Rate limit exceeded`). Max open orders per pair 60 / 80 / 225. **No daily order cap.** A one-minute loop with a few orders a day never approaches any of this. | spot-ratelimits, spot-rest-ratelimits |
| Key permissions | Funds: Query / Deposit / Withdraw. Orders & trades: Query open, Query closed, Modify (= create), Cancel/close. Other: ledger, export, WebSockets. Settings: nonce window, IP allowlist, expiry, query date window. Withdraw must stay OFF on ours. | support: how-to-create-an-API-key |
| Sandbox | None for spot; `validate=true` is the dry run. | |
| Deno | HMAC-SHA512 and SHA-256 native in `crypto.subtle`; nothing to install. | *measured* |

**What it means, next to Revolut X:**

- **Cost is the whole difference.** A resting-limit round trip on Revolut X
  costs the two half-spreads (≈ 1.5–3 bps); on Kraken it costs 80 bps of
  maker fee plus nothing for spread. On $100 that is $0.02 against $0.80 a
  round trip. §3.3 prices the same rules on both: over the out-of-sample
  year the fee alone takes 8–14 points off the trend rule and 10–14 off the
  momentum rule. Kraken is not the venue for live money at this size and
  turnover; it might be at the $2.5k / $10k volume tiers, which $100 will
  never reach.
- **Data is Kraken's strength.** Its book is 100× tighter and orders of
  magnitude deeper, so its mid is the cleaner "fair price" for marking and
  for spotting a stale Revolut X quote; and its quarterly CSV bundle is full
  history from each pair's listing — the right source for the next round of
  backtests (Coinbase's 3 years stand in today).
- **`validate=true` is a real gift**: every key's trading permission, and
  every order's shape, can be checked without an order. Revolut X has no
  equivalent; its first live order is the test.
- **Both venues in paper, side by side, is free** and answers the one
  question a backtest cannot: how often does a post-only order at the touch
  actually fill on a thin book versus a deep one? The dashboard shows the two
  twins (`trend-4h` / `trend-4h-kraken`, `momentum-1d` / `momentum-1d-kraken`)
  on the same rules with each venue's own candles, touch and fee.
- **Funding.** The Kraken account is a UK account: Davies deposited £75 on
  2026-09-20. Kraken's app shows it as ≈ $100 (its USD-equivalent view),
  but the API says what the account holds: `ZGBP 75.0000`, no USD (probe,
  19:08 UTC, via the read-only `probe` action). The strategies trade
  `*/USD`, so a LIVE Kraken order would fail for lack of USD until the
  pounds are converted — one GBP/USD order (0.5 bps wide, $3.4M a day,
  0.20 % FX fee ≈ $0.20), the account's first real order, on Davies' word.
  Paper is unaffected. The `*/GBP` pairs exist (BTC/GBP 0.02 bps, ETH/GBP
  1.3, SOL/GBP 3.7) but are thin and would put a second quote currency into
  a book that is USD everywhere; everything stays `*/USD`. The page names
  every balance the venue reports (GBP, USD, USDC …), not USD alone.

### 2c. The cross-venue basis — measured, and the arbitrage question answered

Davies asked whether the two venues could be played against each other
("跨所价差与套利"). Three measurements, all 2026-09-20, all keyless public data:

**At the touch, every ~4 s for 10 minutes (149 samples, 07:27–07:37 UTC, a Sunday morning):**

| Pair | Revolut X spread | Kraken spread | \|basis\| p50 / p95 / max | Books crossed |
|---|---|---|---|---|
| BTC/USD | 1.72 bps | 0.01 bps | 0.36 / 1.08 / 1.83 bps | 14.8 % of samples |
| ETH/USD | 1.63 | 0.04 | 0.31 / 1.05 / 1.77 | 10.1 % |
| SOL/USD | 4.14 | 0.92 | 0.64 / 1.56 / 2.48 | 0 % |
| XRP/USD | 7.23 | 1.01 | 0.94 / 1.99 / 3.11 | 0 % |
| DOGE / ADA / LINK / AVAX | 7–10 | 0.1–5 | 0.6–1.5 / 1.5–3.3 / 2.5–8.2 | 0–0.7 % |

"Crossed" means Revolut X's bid stood above Kraken's ask or its ask below
Kraken's bid — a riskless trade before fees. It happens on BTC and ETH one
sample in seven, by well under 1 bp. Revolut X follows Kraken within one
4-second sample on BTC/ETH (lag-1 correlation ≈ 0); SOL/XRP/ADA show a
small one-sample lag (0.14–0.18).

**At 1-minute closes over 12 h and 5-minute closes over 60 h** (Revolut X
public candles against Kraken OHLC): BTC \|basis\| p95 6 bps, p99 10, max 18;
ETH p95 8.5, p99 14–16, max 33; SOL p95 13–16, p99 21–28, max 49. Counts
above 20 bps in 720 bars: BTC 0, ETH 4, SOL 12–22; above 40 bps: SOL once;
above 80 bps: none. Revolut X's 1-minute returns correlate with Kraken's
previous minute at 0.2–0.3 (the reverse ≈ 0): Kraken leads by seconds to a
minute.

**What it means.** A hedged cross-venue arbitrage pays Kraken's fee on the
hedge leg — 80 bps taker, 40 bps maker if it rests and fills — plus Revolut
X's half-spread. The basis never reached 80 bps in 60 hours and reached 40
once, on SOL. At the touch it is under 3 bps. **There is no arbitrage
between these two accounts at any cadence this system can run**, and the
lead Kraken has over Revolut X is seconds, invisible to a one-minute loop
that may place at most 1,000 orders a day. What the measurement does
license: Kraken's quotes and candles are the cleaner signal (a 0.01 bps
spread against 1.7), so the Revolut X strategies read Kraken's candles
(`signal_venue`) and fill on Revolut X's free maker side — that is the
"1 + 1", and the basis keeps being recorded every turn (`agent_basis`, on
the page) so the verdict stays a measurement rather than a memory.

## 3. What the numbers say (measured, real data)

### 3.1 Cost of a round trip on Revolut X, $100 account

| | taker (market orders) | maker (resting limit orders, if filled) |
|---|---|---|
| BTC | 2 × (9 + 0.75) = **19.5 bps = $0.195** | 1.5 bps = $0.015 |
| ETH | 20.1 bps = $0.201 | 2.1 bps = $0.021 |
| SOL | 21.1 bps = $0.211 | 3.1 bps = $0.031 |

One taker round trip per hour burns ≈ 75 % of the account per month before any edge. **Anything that trades faster than a few times a day is dead on arrival at taker cost**; the only way frequent trading survives on this venue is resting limit orders at 0 % maker — which fill only when the market comes to you, and adverse selection is then the cost.

Jev at one call per minute costs ≈ $0.06/day. The model is not the budget constraint; the 1,000-orders/day cap and the fee drag are.

### 3.2 Baseline rules, two years (2024-09-20 → 2026-09-20), no look-ahead, executed next-bar-open, net of costs

Buy-and-hold over the window: BTC +26 %, ETH +2 %, SOL −25 %. Selected rows (full table in `scraps/agents-baseline-backtest.py`):

| Rule | BTC gross / maker / taker | ETH | SOL | trades/day |
|---|---|---|---|---|
| SMA 20/100, 4h bars | +62 / +62 / **+54** | +7 / +6 / 0 | +8 / +7 / +2 | 0.08 |
| SMA 50/200, 4h | +45 / +44 / +41 | **+170 / +170 / +164** | +35 / +34 / +31 | 0.03 |
| 30-day time-series momentum, daily | +45 / +44 / +35 | +139 / +138 / +127 | +24 / +23 / +17 | 0.07–0.10 |
| SMA 10/50, **1h** | +16 / +12 / **−28** | +35 / +28 / −17 | −6 / −12 / −41 | 0.65 |
| Hourly RSI mean-reversion | +8 / +4 / **−38** | −17 / −22 / −55 | −26 / −32 / −60 | 0.8 |

Read it the honest way: (a) the same signal that is positive gross is deeply negative at taker cost once it trades more than ~0.3 times a day; (b) slow trend/momentum rules on 4h–1d bars kept most of their gross return and cut the drawdown versus holding, including staying flat through SOL's −25 %; (c) **this is one two-year window with parameters chosen after looking**, so these are proof of the *cost structure*, not a promise of return. The real backtest in the feature will be walk-forward over the full three-year venue history with out-of-sample parameter selection.

### 3.3 Walk-forward backtest of the two rulebooks (the code the site runs)

`supabase/functions/agents/backtest.ts` drives the SAME functions the live
loop runs (`_shared/agents_strategy.ts`) over three years of Coinbase hourly
candles resampled to 4h and daily, net of Revolut X's costs, no look-ahead
(decide on the closed bar, fill at the next open). Coinbase stands in for the
venue's price: over the year both cover, Revolut X's 4h closes sit within a
median 1.6 / 2.2 / 2.7 bps of Coinbase's (BTC / ETH / SOL; p95 6–13 bps; 2,244
common bars). Parameters are chosen on the first two years and the last year
(2025-09-10 → 2026-09-20) is reported OUT of sample. Full output:
`docs/agents/backtests/latest.json`.

That out-of-sample year was a bear market — buy-and-hold BTC −28 %, ETH −40 %,
SOL −50 % — which is the fairest kind of test for a long/flat trend rule.

| | BTC | ETH | SOL |
|---|---|---|---|
| Buy & hold, OOS year | −28.1 % | −40.1 % | −50.2 % |
| trend-4h, grid-chosen params, OOS | −18.0 % (DD 24 %, 26 trades) | **+3.7 %** (DD 19 %, 16) | **+27.8 %** (DD 11 %, 14) |
| trend-4h, default 20/100/3×ATR, OOS | −9.6 % (DD 18 %, 28) | −7.0 % (DD 20 %, 22) | +18.5 % (DD 23 %, 14) |
| momentum-1d (30 d), OOS | −13.6 % (DD 31 %, 45) | +6.1 % (DD 38 %, 33) | −29.4 % (DD 57 %, 37) |
| trend-4h, full 3 y (in-sample params) | +47 % | +233 % | +215 % |
| momentum-1d, full 3 y | +119 % | +272 % | +505 % |

Read it honestly:

- **The trend rule did its job in the bear year**: it cut the loss from
  −28 / −40 / −50 % to −10..−18 / −7..+4 / +19..+28 %, spending 5–17 % of the
  time in the market. It did not make money on BTC that year under any
  parameters.
- **The grid-chosen parameters were worse than the defaults on BTC and ETH**
  out of sample and better on SOL — the textbook signature of fitting noise.
  Parameter choice matters less than the rule's existence; the strategy ships
  with the defaults, and the walk-forward exists so a future "improvement" has
  to beat this table out of sample, not in it.
- **momentum-1d is the weaker rule out of sample** (whipsawed on SOL, 37 round
  trips for −29 %). It stays in paper until its paper record earns anything
  else.
- **The three-year totals are in-sample and include the 2023–25 bull run.**
  They are shown because the site will show them, with the same caveat, never
  as the headline.
- **Jev is not in the backtest.** Its vote is measured live in paper by
  recording every decision with and without it; a backtest that pretended to
  know what it would have said would be a number this repository has learned
  not to trust.


**The same rules priced on Kraken** (`docs/agents/backtests/latest.json` →
`results.<symbol>.kraken`; parameters unchanged, only the venue's fees and
half-spread differ — maker 40 bps / taker 80 bps at this account's tier, spread
≈ 0). Out-of-sample year, then the full three years:

| | BTC | ETH | SOL |
|---|---|---|---|
| trend-4h OOS — Revolut X → Kraken | −18.0 % → **−27.8 %** | +3.7 % → **−4.7 %** | +27.8 % → **+18.4 %** |
| momentum-1d OOS — Revolut X → Kraken | −13.6 % → **−27.6 %** | +6.1 % → **−6.7 %** | −29.4 % → **−38.9 %** |
| trend-4h full — Revolut X → Kraken | +47 % → +3 % | +233 % → +156 % | +215 % → +113 % |
| momentum-1d full — Revolut X → Kraken | +119 % → +43 % | +272 % → +173 % | +505 % → +362 % |

Reading: at 14–45 round trips a year the Kraken fee costs 8–14 points of
return a year on the trend rule and 10–14 on momentum. What Kraken's deeper
book gives back — fewer unfilled resting orders, no adverse selection on a
thin touch — is not in a backtest at all; that is what the paper twins
measure.

### 3.3a Re-run with the loop's own fills, stops and cooldown (2026-09-20, evening)

The review of PR #211 found the tables above priced a fill the loop never
places (a guaranteed next-open maker fill) and ran none of the protective
exits the loop checks every minute. The backtester now fills the way the
loop fills — Revolut X **takes the touch** (9 bps taker + half-spread;
a bid resting on a breakout fills exactly when the breakout fails), Kraken
rests post-only (40 bps maker) — reads the **8 % floor under cost**
against each bar's low (and, until the 2026-09-21 correction below, a
3×ATR(14) trail beside it), and waits **two bars after any
exit** before re-entering (without which a floor stop under a rule that is
still "on" sells and re-buys every bar: momentum on BTC made 155 trades in
the out-of-sample year before the cooldown, 45 after). XRP now carries its
measured spread (Revolut X 5.8 bps, Kraken 1.0) in the basket. Same data,
same split; `noStops` is the same fill model without the protective exits.
`docs/agents/backtests/summary.json` is written by the backtester itself.

**Re-run 2026-09-21 without the duplicated intra-bar ATR trail** (§3.13,
§4.11). The table below is the loop as it stands now: the 8 % floor under
cost checked every minute, the rulebook's own 3×ATR trail on the close,
and nothing else. The figures this section carried until then are kept in
the paragraph after it, because the change to them is the finding.

| symbol | rule | Revolut X OOS (shipped) | without stops | Kraken OOS | buy & hold OOS |
|---|---|---|---|---|---|
| BTC | trend-4h | -19.3 %, DD 24 %, 26 trades, 0 stops | -19.3 %, DD 24 %, 26 trades | -25.4 %, 26 trades | -28.1 % |
| BTC | momentum-1d | -17.0 %, DD 33 %, 45 trades, 0 stops | -17.0 %, DD 33 %, 45 trades | -27.6 %, 45 trades | -28.1 % |
| BTC | trend-1h | -14.1 %, DD 22 %, 74 trades, 0 stops | -13.3 %, DD 22 %, 74 trades | — (paper only on Revolut X) | -28.1 % |
| ETH | trend-4h | +2.8 %, DD 20 %, 16 trades, 0 stops | +2.8 %, DD 20 %, 16 trades | -2.0 %, 16 trades | -40.1 % |
| ETH | momentum-1d | +10.4 %, DD 35 %, 33 trades, 3 stops | +3.0 %, DD 39 %, 33 trades | +0.0 %, 33 trades | -40.1 % |
| ETH | trend-1h | +8.2 %, DD 21 %, 60 trades, 0 stops | +6.0 %, DD 23 %, 62 trades | — (paper only on Revolut X) | -40.1 % |
| SOL | trend-4h | +27.0 %, DD 11 %, 14 trades, 0 stops | +27.0 %, DD 11 %, 14 trades | +21.8 %, 14 trades | -50.2 % |
| SOL | momentum-1d | -29.2 %, DD 56 %, 43 trades, 6 stops | -31.8 %, DD 58 %, 37 trades | -37.8 %, 43 trades | -50.2 % |
| SOL | trend-1h | +13.1 %, DD 20 %, 58 trades, 0 stops | +14.1 %, DD 19 %, 58 trades | — (paper only on Revolut X) | -50.2 % |

Trend-4h parameters chosen in-sample under this model: BTC {'fast': 30, 'slow': 100, 'atrStop': 4}, ETH {'fast': 30, 'slow': 50, 'atrStop': 3}, SOL {'fast': 30, 'slow': 150, 'atrStop': 2}. Full-period (in-sample, never the headline) Revolut X: trend-4h +35.9 % / +223.1 % / +208.7 %, momentum-1d +112.2 % / +268.3 % / +460.6 %.

**Read the `stops` column first: it is 0 on every trend row.** With the
intra-bar trail gone the 8 % floor never fires on BTC, ETH or SOL in the
out-of-sample year at all — shipped and "without stops" are the same
number to the digit on all three 4-hour rows — so every protective exit
this section used to report was the duplicated trail, and the floor was
inert the whole time. What the old table called "the stops" was one stop.
The trail cost SOL ten points in the year it was not needed (+17.3 before
against +27.0 now) and ETH nearly four (−1.0 → +2.8), and on BTC the
parameter search moved with it (−16.5 → −19.3, the grid choosing a
different point once the trail stopped truncating trades). The taker fee
on Revolut X is still worth about two points a year on the 4-hour rules
and more on the hourly one. Momentum and the rotation basket are
unchanged, because neither ever carried a trail: the basket is default
−16.2 % OOS on Revolut X (exposure 30 %, 26.0×/y), no bear filter −59.4 %,
top 3 −8.1 %, 7-day hold −15.1 %; equal-weight buy-and-hold −46.7 %.

**What this section said before the correction**, so the record shows what
was claimed and when it was found wrong: BTC trend-4h −16.5 % with 11
stops, ETH trend-4h −1.0 % with 6, SOL trend-4h +17.3 % with 6, BTC
trend-1h −9.3 % with 36, ETH trend-1h −6.9 % with 33, SOL trend-1h
+14.1 % with 31; Kraken −22.8 / −5.7 / +12.5; and the reading "the stops
cost a little in the year they were not needed and saved a little where
they were", which was describing one stop firing on wicks and a floor
that never fired at all.

### 3.4 The rotation rulebook and the 1-hour trend variant (walk-forward, both venues)

**Re-run 2026-09-21 with the loop's stops and cooldown in it.** Until that
day `runRotation` ran the bare rank rule: no floor under a slot, no
cooldown after an exit — so every figure this section used to print
described a rule the loop does not run, while §4.11 claimed the opposite.
The pre-live review found it (`docs/agents/reviews/`, S2). The table below
is the rule as the loop runs it, with the bare rank rule beside it as the
counterfactual; both from `docs/agents/backtests/latest.json`.

`rotation-1d`: rank BTC, ETH, SOL and XRP by 30-day return at each daily
close, hold the top two equal-weighted, and only those above their
100-day average (dual momentum). 1,101 aligned days, 2023-09-16 →
2026-09-20, split 2025-09-19; fills at the next day's open at the venue's
half-spread and fee (Revolut X takes the touch, Kraken rests). Out of
sample is the bear year. **Shipped** = the 8 % floor under each slot's own
cost, read against the day's low, and no re-entry into a symbol for two
days after any exit from it.

| Variant | Revolut X OOS (shipped) | bare rank rule | Kraken OOS (shipped) | bare | Exposure | Turnover | Revolut X full | Kraken full |
|---|---|---|---|---|---|---|---|---|
| default (top 2, filter on) | **−16.2 %** (DD 33 %, 63 trades, 8 stops) | −14.4 % (DD 32 %, 64) | **−23.6 %** | −20.9 % | 30 % | 26×/y | +67.8 % | +26.4 % |
| filter OFF (always in) | −59.4 % (DD 70 %, 143, 32 stops) | −47.4 % (DD 63 %, 102) | −67.0 % | −52.9 % | 96 % | 37×/y | +26.5 % | −21.6 % |
| 7-day minimum hold (the Kraken seed) | −15.1 % (DD 32 %, 43, 11 stops) | −17.1 % (DD 35 %, 40) | **−13.2 %** | −16.1 % | 36 % | 17×/y | −1.6 % | −16.0 % |
| top 1 | −43.9 % (DD 50 %, 55, 6 stops) | −36.8 % (DD 46 %, 51) | −52.4 % | −45.7 % | 24 % | 36×/y | −21.1 % | −57.2 % |
| top 3 | −8.1 % (DD 30 %, 62, 7 stops) | −6.2 % (DD 29 %, 63) | −13.3 % | −6.9 % | 30 % | 16×/y | +80.8 % | +44.5 % |
| 60-day lookback | −19.7 % (DD 38 %, 46, 8 stops) | −17.2 % (DD 36 %, 44) | −25.0 % | −22.4 % | 30 % | 17×/y | +37.5 % | +4.0 % |
| equal-weight buy & hold | −46.7 % | | | | 100 % | | +225.1 % | |

**The finding that matters: the 8 % floor makes the rotation rule worse,
on five variants of six.** Default −16.2 % against the bare rule's
−14.4 % out of sample, and +67.8 % against +108.2 % over the three years;
with the bear filter off it is −59.4 % against −47.4 %, because the floor
sells into every dip and the two-day cooldown then keeps the slot out of
the rebound the rank rule would have ridden. The one variant it helps is
the 7-day hold — the Kraken seed — where the minimum hold already damps
the churn (−15.1 % against −17.1 %, and −13.2 % against −16.1 % on
Kraken). A floor under a rank rule is not a stop on a position; it is an
exit rule the rank rule does not have, and this is what it costs. **It is
not changed** — changing a stop because two years of one basket preferred
another is the fit the bar exists to refuse — but it is now written where
the rotation rows' record is read, and the paper record is the test.

Reading the rest: the bear filter is still what protects capital — with
it off the rule follows the market down (−59.4 % against −16.2 %). It is
a parameter (`bearFilter`) Davies can switch off, with these numbers in
front of him. Kraken's 40 bps costs 7 points a year at 26 round trips
(−23.6 % against −16.2 %); the 7-day hold cuts turnover to 17×/y and is
the only shape whose two venues come out close. Top 3 was least bad out
of sample and top 2 best over the full period, as before; one bear year
cannot separate them, so the seed keeps top 2. **Every out-of-sample
figure in this table is negative**: this rulebook has not made money in
the year it was tested on, on either venue, with or without its stops.

`trend-1h` (the 4-hour trend rule on 1-hour candles, volatility annualised
for 24 bars a day), shipped stops, Revolut X costs, out of sample: BTC
−9.3 % (DD 18 %, 78 trades, 36 of them stops) / ETH −6.9 % (DD 22 %, 70) /
SOL +14.1 % (DD 23 %, 66) — the figures in §3.3a's table, which is this
rule's current record. Without the stops: −13.3 % / +6.0 % / +14.1 %. It
is seeded paper-only on Revolut X because it produces decisions and fills
fast enough to judge the loop and the model within days, which the daily
rules cannot; at Kraken's 40 bps its ~70 fills a year would cost ~28 % a
year in fees.

### 3.5 The friend's three ideas — breakouts, double bottoms, illiquidity events — tested (2026-09-20)

Same data and harness as §3.3 for the two chart patterns (three years of
Coinbase hourly → 4-hour candles, Revolut X costs, next-bar-open fills,
walk-forward split at two thirds, 3×ATR stop); a separate 1-minute study
for the illiquidity idea. Numbers are OOS return / max drawdown / trades,
then the full period. Scratch scripts, not shipped: `patterns_bt.py`,
`m1/disloc_final.py`.

| variant | BTC OOS | BTC full | ETH OOS | ETH full | SOL OOS | SOL full |
|---|---|---|---|---|---|---|
| trend baseline (the 4h rule, default params) | −5.4 % / 21 % / 32 | +42 % / 110 | −24.7 % / 35 % / 32 | +117 % / 88 | +6.4 % / 32 % / 22 | +74 % / 106 |
| **breakout + volume ≥ 1.5× its 20-bar average** | −10.5 % / 24 % / 30 | +27 % / 104 | −24.2 % / 34 % / 30 | +72 % / 84 | +0.5 % / 34 % / 20 | +66 % / 96 |
| **Bollinger-squeeze breakout** (band width at a 100-bar low, close above the upper band) | +19.7 % / 13 % / 30 | +15 % / 70 | −18.9 % / 19 % / 26 | −34 % / 74 | −1.9 % / 28 % / 26 | −27 % / 64 |
| **double bottom** (two lows within 1.5 % of each other 10–60 bars apart, entry on the close above the neckline) | +5.4 % / 4 % / 12 | +19 % / 42 | −13.9 % / 20 % / 32 | +11 % / 92 | −24.8 % / 28 % / 10 | −34 % / 44 |

- **Volume confirmation makes the trend rule worse** on every symbol in
  both windows: the breakouts it filters out were the ones that worked.
  Not adopted.
- **The squeeze breakout** is one good BTC window and losses everywhere
  else, including the full period on ETH and SOL. Not robust; not adopted.
- **Double bottom** is quiet on BTC (12 trades, 4 % drawdown) and negative
  on the other two; the full-period ETH result comes from one 2024 stretch.
  Not adopted as a rule. Both pattern ideas can be revisited once the
  loop has months of its own fills to compare against.
- **Illiquidity events: the study found an artefact, and the rule is now
  a measurement.** 30 days of 1-minute closes on Revolut X against
  Coinbase (the Kraken proxy with a 1-minute history): after Revolut X's
  close prints ≥ 15 bps under the reference, Revolut X's own close
  "recovers" +20–30 bps over the next half hour, and a rule that lifted the
  ask at once and rested its exit at the reference showed +8.1 bps a trade
  on BTC (27 trades) and +4.3 on ETH (95), weaker in the second half of the
  sample, negative on SOL and XRP. **That number does not survive one more
  question.** In 60–73 % of those "cheap" minutes Revolut X traded NOTHING
  (`m1/stale_check.py`): the close is a carried last trade, not a quote.
  And the REFERENCE's own forward return after a cheap print is about zero
  (BTC k = 15: −1.9 / +4.1 / +1.9 bps at 5 / 15 / 30 min; ETH +0.8 / +0.2 /
  +5.3). What the study measured is a stale print catching up with the
  market — which no order at the live touch can capture, because the touch
  never left. A resting bid at the print, the cheap version of the trade,
  fills almost never (BTC k = 10: 4 fills in 28 days, −14.7 bps each; ETH
  16 fills, −9.5) and loses when it does.

  What survives: the mechanism itself (a thin book can sit under the deep
  one) is worth watching, and the touch is the only thing worth trading.
  `dislocation-1m` is seeded PAPER on Revolut X, BTC and ETH, reading the
  **touch basis** (both venues' live mids, the quantity `agent_basis` and
  the observations record every minute): it buys only when the ask itself
  sits 15 bps under Kraken's mid with Kraken not moving sharply, rests the
  exit at the reference, and is out after 30 minutes or 40 bps at the bid.
  The 10-minute touch sample in §2c (max |basis| 1.8 bps on the majors)
  says this may be rare; a week of the loop's own record will say how rare,
  and whether the touch ever dislocates the way the closes did. **Expected
  return: none claimed.** What would make it more than a measurement: the
  touch basis crossing 15 bps a few times a week in the record, and the
  paper fills that follow averaging positive after the 9 bps taker fee over
  ≥ 100 trades.

  **Retired 2026-09-21, migration `0038` — and its one trade was a bug,
  not a trade.** For seven hours the touch basis never came within half
  of the entry (max |basis| 7.7 bps; nor in the 60 hours of §2c). At
  01:26 UTC on the Monday the rule read Revolut X's ask 29.5 bps under
  Kraken's mid, lifted it (paper, 0.00024394 BTC @ 81,984.09, Jev
  P = 0.83 with caution 1.00), and one minute later its own stop sold at
  the bid 50 bps lower: −68 bps all-in. Those prices were the **EEA
  book's**. §2.2 already recorded that the venue publishes two books per
  pair (`region: UK` / `EEA`) and that an account trades on its own; the
  client's `quotes()` kept whichever ticker row came last, so every
  Revolut X quote the loop had read — marks, stops, the basis record, this
  entry — was UK or EEA at random, and the region-less public candles it
  paper-filled against are the EEA book's too. That night the EEA book
  was thin (SOL bid 110.32 / ask 112.37 at 01:35, XRP 1.4 % wide) while
  the UK book, the one this account can trade, sat 0.1–6 bps wide. Fixed
  the same night (§2.2, §4.14): the client asks for the account's region
  on tickers and candles and drops any other region's row. Davies had
  already asked for the rule to go rather than sit on the page. The row
  is retired in place (`retired_at`, paused — the first cut of `0038`
  deleted it and the foreign key from `agent_decisions` refused, which
  is the right answer: the records are the evidence); the rulebook stays
  in `_shared/agents_strategy.ts` and the tick, dormant; un-retiring is
  a migration. `agent_basis` keeps measuring every turn (rows before the
  fix mix the two books).

### 3.6 Faster rules — 15-minute and 1-hour bars, walk-forward, the loop's own fills (2026-09-21)

Davies asked why every rule waits hours between decisions when Jev
answers in 300 ms for nothing, and whether a faster rule could be tested.
One year of Coinbase 15-minute candles per symbol (34,993 bars,
2025-09-21 → 2026-09-20; the 60-minute rows are the same bars
aggregated), the loop's own fills (every order takes the touch: half the
measured spread plus 9 bps taker, each way, next-bar-open), the shipped
stops (8 % floor, 3×ATR trail on bar lows) and the two-bar cooldown. Two
rules: the trend rule (fast/slow SMA and a close above the prior N-bar
high; grid fast 10/20/30 × slow 50/100/200 × breakout 20/55) and an
RSI(2) pullback (buy the dip above a slow SMA, sell the bounce; grid SMA
100/200 × entry 5/10/20 × exit 60/70/80 × max hold 8/16 bars).
Parameters chosen on the first eight months by return over drawdown, the
last four months reported out of sample. Numbers: in-sample return of the
chosen set → OOS return / max drawdown / trades. Raw output and method:
`docs/agents/backtests/frequency.json`; script scratch, not shipped
(`m15/freq_study.py`).

| bar | rule | BTC | ETH | SOL | buy & hold OOS |
|---|---|---|---|---|---|
| 15 m | trend | −13.7 % → **−21.2 %** / 23 % / 95 | −23.3 % → **−4.2 %** / 20 % / 97 | −36.9 % → **−15.2 %** / 27 % / 107 | +5.5 % / +26.0 % / +28.4 % |
| 15 m | RSI(2) pullback | −85.5 % → **−62.8 %** / 63 % / 589 | −88.2 % → **−64.0 %** / 64 % / 613 | −90.1 % → **−67.3 %** / 68 % / 601 | same |
| 60 m | trend | −12.3 % → +10.6 % / 6 % / 24 | −12.3 % → +20.6 % / 10 % / 27 | −17.5 % → +21.5 % / 12 % / 18 | same |
| 60 m | RSI(2) pullback | −39.6 % → −20.4 % / 22 % / 128 | −51.7 % → −25.3 % / 26 % / 153 | −32.8 % → −16.3 % / 20 % / 154 | same |

- **Nothing at 15 minutes survives.** The trend rule's own BEST
  in-sample parameters lose on every coin, in sample and out; there is no
  edge to select, only the cost. About 100 round trips in four months is
  300 a year, and a round trip at the touch costs 20 bps (2 × 9 bps taker
  plus the spread): 60 % of the account a year before the rule is right
  once. The pullback rule makes 600 round trips in the window and loses
  60–70 % — that is the fee bill, not the market.
- **The 60-minute rows are not evidence of an edge either.** Every one of
  the 18 in-sample fits loses; the positive out-of-sample figures are 18–27
  trades chosen by a fit that itself lost, which is what selection noise
  looks like, and buy-and-hold beat two of the three. The 1-hour trend
  rule the loop already runs in paper (§3.4) stays the fastest rule, and it
  stays paper.
- **The constraint is the round-trip cost, not the model.** Jev is asked
  on entries only and costs nothing that matters at any cadence; a bar
  that closes more often means more entries and every entry pays 20 bps
  on Revolut X and 80 on Kraken. Speed is bought with fees, and at this
  spread the fee wins below an hour.

### 3.7 A wider universe — four more coins, a bar written first, one addition (2026-09-21)

Davies asked for more coins to be tested and the good ones added. The
candidates were every Revolut X pair whose UK book was under 10 bps wide
with real volume at 12:47 UTC: XRP (4.7 bps, already in the rotation
basket), DOGE 6.4, LINK 8.4, ADA 8.5 and AVAX 9.6. TON's 0.7 bps sat on
$8.6k of daily volume and was ignored; the next tier (SHIB, BNB, HBAR,
PEPE, XLM) is 11–15 bps, DOT 16, NEAR / SUI / BCH / ARB 19–24, the rest
25–40 — a round trip there costs 40–100 bps before the rule is right once.
Three years of Coinbase hourly candles per coin (from 2023-09-22), the
shipped backtester (`--symbols`, `--basket`, `--study universe`), the
loop's own fills, stops and cooldown, parameters chosen on the first two
years and the last year reported out of sample — a year in which holding
any of these coins lost 28–72 %. Kraken's spreads for the candidates were
read from its public ticker the same hour (ADA 4.1 bps, AVAX 1.7, LINK
0.0, DOGE 4.4). Raw output: `docs/agents/backtests/universe.json`.

**The bar, written down before the numbers were looked at.** A coin joins
the 4-hour trend rule only if, out of sample: (1) the rule is positive net
of Revolut X costs; (2) its drawdown is under 35 %; (3) at least half of
the 27-point parameter grid (fast 10/20/30 × slow 50/100/150 × ATR stop
2/3/4) is positive out of sample — a **plateau**, not a fitted spike, which
is the honest answer to "every strategy is sensitive to its parameters":
an edge has neighbours, a fit does not; (4) the same rule is positive on
Kraken costs, so the result is not an artefact of one fee schedule. The
backtester now reports the plateau for every coin (`plateau`: share of the
grid positive out of sample, the grid's median, where the chosen point
ranks). Momentum-1d would take a coin only if positive out of sample with
drawdown under 35 %; the wider rotation basket would replace the four-coin
one only if it beat it on both return and drawdown.

Trend-4h on Revolut X costs, out of sample 2025-09 → 2026-09; "seeded" is
the parameter set the live rows run (fast 20, slow 100, ATR 3):

| coin | chosen params OOS / DD / trades | seeded OOS | grid positive / median | Kraken costs chosen / seeded | buy & hold | momentum-1d OOS |
|---|---|---|---|---|---|---|
| BTC | −16.5 % / 21 % / 26 | −13.6 % | 0 % / −13.8 % | −22.8 % / −21.6 % | −28.1 % | −17.0 % |
| ETH | −1.0 % / 23 % / 16 | −10.3 % | 7 % / −10.3 % | −5.7 % / −16.5 % | −40.1 % | +10.4 % |
| SOL | +17.3 % / 15 % / 14 | +13.3 % | 100 % / +14.0 % | +12.5 % / +8.0 % | −50.2 % | −29.2 % |
| XRP | −11.2 % / 17 % / 14 | −3.1 % | 41 % / −3.1 % | −14.7 % / −5.8 % | −56.0 % | −47.3 % |
| DOGE | −12.5 % / 18 % / 12 | +4.7 % | 11 % / −7.0 % | −15.6 % / +1.6 % | −64.9 % | −31.4 % |
| LINK | +4.3 % / 18 % / 21 | +3.8 % | 89 % / +4.3 % | −1.5 % / −1.3 % | −43.5 % | −13.6 % |
| ADA | −9.4 % / 16 % / 14 | −14.6 % | 15 % / −9.4 % | −13.0 % / −18.0 % | −72.2 % | −38.4 % |
| **AVAX** | **+40.3 % / 12 % / 9** | **+12.1 %** | **85 % / +13.9 %** | **+36.9 % / +9.1 %** | −65.1 % | −37.6 % |

- **AVAX clears all four and joins trend-4h on both venues, paper**
  (migration `0039`; the rows' paper capital goes from $60 to $80 so each
  of four symbols keeps its $20 slot). *Later the same day (§3.8) the
  same four tests on the middle third came back negative for AVAX; it
  stays in paper because the record is the test, but the bar has since
  been tightened to two windows.* Its plateau is the strongest in the
  table after SOL's, the seeded parameters make money on both venues, and
  the drawdown is the smallest. Nine trades in the year is thin, and the
  UK book is 9.6 bps wide (one snapshot), so a round trip costs about 28
  bps against the majors' 20: paper first, and the paper record decides.
- **LINK clears three of four** — positive on Revolut X with an 89 %
  plateau, but −1.5 % / −1.3 % on Kraken costs — and stays a watch. If a
  quarter of paper on AVAX goes as the backtest says, LINK on Revolut X
  alone is the next candidate; the bar is not lowered for it now.
- **DOGE is the fitted spike in person**: the parameters chosen in sample
  ranked 26th of 27 out of sample (11 % of the grid positive) while the
  seeded ones happened to make +4.7 %. **ADA** fails everything; **XRP**'s
  plateau is 41 %, its seeded result −3.1 %.
- **Momentum-1d takes no coin**: the daily momentum rule lost 31–47 % on
  every alt in the bear year and made money only on ETH (+10.4 %); its
  full-period figures come from the 2024 run. Nothing changes.
- **The 8-coin rotation basket is worse than the 4-coin one**: default
  variant OOS −24.2 % with 46 % drawdown against −14.4 % / 32 % (top 3:
  −17.6 % against −6.2 %). More coins gave the ranking more ways to be
  wrong. Nothing changes.
- **On 1-hour candles** the same trend rule read LINK +7.2 %, AVAX +3.9 %,
  DOGE −17.9 %, ADA −6.8 % out of sample — nothing joins trend-1h.
- **Caveats, all of them.** One out-of-sample year, and a bear one, so a
  rule that only had to stay out of the way looks good; nine AVAX trades;
  spreads from a single snapshot; and the plateau is measured on the same
  year the chosen point is judged on. The bar is what keeps this honest,
  and the paper record is what it has to match.

### 3.8 The top twenty by market cap, tested — one bar, two windows, one more addition (2026-09-21)

Davies asked why only four coins had been tested (§3.7's answer: the
Revolut X pairs under 10 bps with volume, at one snapshot) and for the
whole top twenty by market cap, stablecoins aside, to be run. From
CoinGecko's top 24 ex-stables and wrapped assets that day, the untestable
ones and why: ZEC and XMR are not on Revolut X at all; TRX has no Coinbase
history and trades $5k a day on the UK book; FIGR_HELOC, WBT, RAIN, LEO
and CC are exchange or tokenised-asset tokens on neither venue. The 16
that remain — BTC, ETH, BNB, XRP, SOL, HYPE, DOGE, LINK, ADA, XLM, UNI,
NEAR, BCH, AVAX, LTC, SUI — plus the next tier (DOT, HBAR, TON, SHIB,
PEPE, AAVE, ETC, ALGO, ICP, POL, ATOM) make 27. Three years of Coinbase
hourly candles each (no zero-volume hour in any series, gaps ≤ 0.14 %;
short histories flagged: HYPE 0.62 y, TON 0.84 y, BNB 0.91 y — Coinbase
listed it 2025-10-22 — PEPE 1.85 y, POL 2.05 y). Spreads are medians of
21 samples a minute apart (13:35–13:55 UTC) on the UK book and on
Kraken's ticker, and the run prices every coin at them; the round trip
on Revolut X is 18 bps plus the full spread. An Opus subagent ran it
(`universe20.json`, the basket runs beside it); it found two defects in
the backtester that were fixed the same day — the 1-hour check read the
basket's truncated daily bars, so a young basket member let entries
through on other coins, and a symbol outside the basket crashed the run
— and the shipped numbers are unchanged by the fix.

Median UK-book spreads (bps) and 24 h quote volume: BTC 1.5 / $3.6m ·
ETH 2.1 / $3.2m · SOL 3.9 / $3.3m · XRP 5.4 / $2.6m · AAVE 4.9 / $54k ·
DOGE 7.5 / $199k · LINK 7.7 / $693k · UNI 8.2 / $159k · ADA 9.5 / $122k
· LTC 10.2 / $44k · BNB 10.5 / $19k · AVAX 10.6 / $1.9m · HBAR 11.2 /
$114k · SHIB 11.4 / $11k · XLM 13.6 / $176k · PEPE 14.2 / $102k · DOT
16.2 / $769k · ALGO 16.5 / $180k · BCH 20.7 / $928k · ATOM 21.8 / $17k ·
SUI 23.9 / $942k · HYPE 24.6 / $123k · NEAR 25.4 / $2.8m · ICP 34.1 /
$171k · ETC 34.2 / $8k · POL 35.5 / $11k · TON 35.8 / $8k.

**Trend-4h against §3.7's bar, last third out of sample** (chosen
parameters' return / drawdown / trades, seeded parameters' return,
plateau share and median, Kraken chosen / seeded, buy-and-hold):

| coin | OOS / DD / trades | seeded | plateau | Kraken | b&h | verdict |
|---|---|---|---|---|---|---|
| SOL | +17.3 % / 15 % / 14 | +13.3 % | 100 % / +14.0 % | +12.5 / +8.0 | −50 % | clears (in) |
| UNI | +46.8 % / 15 % / 10 | +25.5 % | 74 % / +36.7 % | +42.4 / +20.3 | −2 % | clears |
| AVAX | +40.3 % / 12 % / 9 | +12.1 % | 85 % / +13.9 % | +36.9 / +9.1 | −65 % | clears (in, `0039`) |
| SUI | +14.5 % / 27 % / 19 | −10.5 % | 85 % / +7.6 % | +10.1 / +12.2 | −71 % | clears |
| ICP | +12.4 % / 26 % / 9 | +5.5 % | 70 % / +5.5 % | +10.5 / +3.1 | −38 % | clears |
| POL | +9.4 % / 7 % / 12 | +35.0 % | 100 % / +29.3 % | +6.6 / +33.0 | −27 % | clears (2.05 y) |
| BNB | +8.8 % / 6 % / 7 | +9.8 % | 100 % / +7.4 % | +6.8 / +7.7 | +16 % | clears on 111 days |
| AAVE | +8.5 % / 15 % / 6 | −4.4 % | 63 % / +1.1 % | +6.4 / −6.8 | −51 % | clears |
| LINK | +4.3 % / 18 % / 21 | +3.8 % | 89 % / +4.3 % | −1.5 / −1.3 | −44 % | three of four (Kraken) |
| HBAR | +1.6 % / 14 % / 11 | +1.4 % | 85 % / +2.7 % | −1.6 / −0.6 | −62 % | three of four (Kraken) |
| PEPE | +2.6 % / 15 % / 8 | −20.2 % | 22 % / −9.7 % | +0.2 / −22.9 | +9 % | three of four (plateau) |
| the other 16 | negative on Revolut X, every one | | | | | fail |

BTC −16.5 %, ETH −1.0 %, XRP −11.2 %, DOGE −12.5 %, ADA −9.4 %, XLM
−17.2 %, NEAR −2.0 %, BCH −26.3 %, LTC −7.4 %, DOT −0.0 %, TON −5.6 %,
SHIB −4.8 %, ETC −3.0 %, ALGO −9.0 %, ATOM −7.5 %, HYPE −3.9 %.
**Momentum-1d**: 21 of 27 negative out of sample; the three that clear
its bar are the three short histories (BNB 111 days, HYPE 76, PEPE 226);
no three-year coin clears it, ETH misses on drawdown by 0.11 of a point.
Nothing joins momentum. **Rotation**: the only like-for-like basket (13
coins on the same 364 days) is worse than the four-coin one on every
variant — default −18.6 % with 56 % drawdown against −14.4 % / 32 %,
turning over 28× a year against 21× — and the 16- and 14-coin baskets'
"wins" are 75- and 111-day windows in which holding rose 26–42 %: a
basket is only as long as its shortest coin. Nothing changes.
**Trend-1h** on the new coins: nothing above +11 % (DOT), most negative;
nothing joins it.

**The second window, and the spread doubled.** The same four tests with
parameters chosen on the first third and the MIDDLE third held out — the
check the friend's "then I'm kinda fitting for out of sample" calls for
— and the last-third result with every Revolut X half-spread doubled:

| coin | middle third: OOS / DD / plateau | spread ×2: OOS |
|---|---|---|
| SOL | +7.6 % / 28 % / 22 % | +17.1 % |
| UNI | +9.0 % / 16 % / 30 % | +46.2 % |
| AVAX | −11.5 % / 29 % / 67 % | +39.7 % |
| **SUI** | **+3.0 % / 26 % / 70 %** | +11.9 % |
| ICP | −13.2 % / 25 % / 0 % | +10.9 % |
| **POL** | **+17.6 % / 9 % / 52 %** | +7.0 % |
| BNB | −12.1 % / 12 % / 0 % | +8.4 % |
| AAVE | −7.0 % / 27 % / 37 % | +8.4 % |

Only SUI and POL clear the bar on both windows. All eight stay positive
with the spread doubled — the cost is not what decides these.

**The bar, tightened (§4.15).** From now a coin has to clear the four
tests on both windows, and its Revolut X UK book has to carry at least
$100k a day, so that a $20 order is under 0.02 % of the day and a thin
book's touch is not mistaken for a price. Under it:
- **SUI joins trend-4h on both venues, paper (`0040`; capital 80 →
  100 for the fifth $20 slot).** Its spread is the widest of anything the
  loop trades — a 42 bps round trip, inside every number above — and the
  seeded parameters lose 10.5 % where the chosen ones make 14.5 %, so the
  paper record is read against the chosen set's expectation with that
  gap in mind.
- **POL clears the numbers and waits**: $10.7k a day on the UK book.
- UNI, ICP, AAVE and BNB fail the second window; LINK, HBAR and PEPE
  remain three-of-four watches.
- **AVAX, added by `0039` this morning under the one-window bar, fails
  the second window** (−11.5 % on the middle third with the parameters
  chosen on the first). It stays in paper, because paper is free and the
  record is the test, but under the bar as it now stands it would not
  have been added — written here so its record is read honestly.

Caveats as §3.7's, plus: 27 coins × 27 parameter points × two windows is
1,458 looks at two years, so a handful clearing a four-part bar by luck
is expected, which is why the bar demands both windows and why paper
decides; the coins moved together in the bear year, so 27 is fewer
independent tests than it looks; spreads are one twenty-minute window on
a Monday afternoon.

### 3.9 Five rule ideas against the shipped trend rule (2026-09-21)

Davies asked for other strategy ideas to be tested alongside the wider
universe. Five were written as one study script,
`supabase/functions/agents/backtest_ideas.ts`, which imports the
backtester's `run`, `resample`, `COSTS`, `stopsForKind` and the live
rulebooks rather than re-implementing them (its baseline reproduces
§3.7's table to the digit on all eight coins, which is the evidence the
reuse is faithful). Same data, split, fills, stops, cooldown and plateau
as §3.7; the eight coins with measured spreads; output
`docs/agents/backtests/ideas.json`. Numbers are out of sample on Revolut
X costs: return / max drawdown / fills (an entry and an exit are two),
then the plateau share, then Kraken costs. The baseline clears §3.7's bar
on SOL and AVAX only.

| idea (grid) | what it is | clears the bar on | median over 8 coins: OOS / DD / fills / plateau |
|---|---|---|---|
| baseline | the shipped trend-4h rule | SOL, AVAX | −5.2 % / 17 % / 14 / 28 % |
| 1 regime filter (BTC daily close above its 100 / 150 / 200-day SMA gates every entry) | cross-asset regime | **SOL, LINK, AVAX** | **+3.8 % / 12 % / 8 / 63 %** |
| 2 Donchian 20 / 55 / 100 breakout, exit on a 10 / 20-bar low, no moving-average, momentum or volatility gate | is the MA condition earning its keep? | none | −8.1 % / 25 % / 46 / 11 % |
| 3 pullback in an uptrend (fast over slow; buy within 0.5–1 ATR of the fast SMA; out at the prior 20-bar high or after 12 / 24 bars) | mean reversion at 4 h | ETH only (+46.6 %, one coin of eight; six negative) | −35.6 % / 43 % / 137 / 0 % |
| 4 stale-trend exit (leave after 12 / 24 / 48 bars without a new 20-bar high) | an extra exit | SOL, AVAX — the baseline's own two | +2.2 % / 18 % / 16 / 30 % |
| 5 weekly bars (fast 4 / 8, slow 13 / 26) | fewer trades | ETH only, on a single fill | +3.0 % / 8 % / 2 / 19 % |

Per coin for the regime filter (chosen N / fast / slow → OOS / DD /
fills / plateau / Kraken; baseline OOS beside it): BTC 100/30/100 →
−4.6 % / 11 % / 16 / 78 % / −9.1 % (baseline −16.5 %); ETH 200/10/50 →
+5.7 % / 7 % / 6 / 41 % / +3.8 % (−1.0 %); SOL 200/30/150 → +12.3 % /
8 % / 6 / 100 % / +10.3 % (+17.3 %); XRP 100/30/50 → −16.9 % / 17 % / 10
/ 15 % / −19.3 % (−11.2 %); DOGE 100/20/150 → +6.0 % / 14 % / 10 / 48 %
/ +2.8 % (−12.5 %); LINK 200/10/50 → +2.0 % / 17 % / 7 / 93 % / +0.1 %
(+4.3 %); ADA 100/20/150 → −1.4 % / 16 % / 6 / 41 % / −3.1 % (−9.4 %);
AVAX 100/10/50 → +30.7 % / 9 % / 8 / 89 % / +27.9 % (+40.3 %). With the
same parameters on and off, the filter removed 2–14 fills of 10–28, cut
the drawdown on five coins of eight and raised the return on five, and
took exposure down to 2–6 % of bars.

- **Nothing is adopted.** The regime filter is the one idea that clears
  the bar on a coin the baseline does not (LINK), and it does it by
  holding less in a year when holding lost 28–72 %: every idea that
  improved on the baseline did so by being out of the market more, and
  the two that held most (Donchian, pullback) lost most. That is what a
  bear year rewards, not evidence that a filter picks well. It gave up
  five points on SOL and two on LINK against the baseline's own numbers.
- **The moving-average, momentum and volatility gates earn their keep.**
  Stripped to a bare Donchian the rule fires 15–83 times a year instead
  of 9–25, the median plateau falls from 28 % to 11 %, the median return
  from −5.2 % to −8.1 %, the median drawdown from 17 % to 25 %, and it
  clears the bar nowhere.
- **Mean reversion fails at 4 hours as it did at 15 minutes and 1 hour**
  (§3.6): 86–176 fills a year, six coins negative, plateau 0 % on six —
  the fee bill again, with one coin (ETH) making a number that eight
  coins do not support.
- **Weekly bars are one or two trades a year**, from which no edge can
  be estimated; three coins' whole loss is the 8 % floor, which was sized
  for 4-hour bars, hit intra-bar almost by construction.
- **What would change the answer on the regime filter**: the same test
  with the middle third held out instead of the last (a window that is
  not a bear year) agreeing with this one, and then a paper twin of
  trend-4h with the filter on, measured against the unfiltered row for
  a quarter. Until then it is the next candidate, written down, not a
  rule.
- Caveats as §3.7's, and one more: 864 parameter × coin pairs were
  looked at against one year (1,080 with the baseline's), so two or
  three pairs clearing a four-part bar by chance is expected, which is
  why a single-coin pass (ETH on ideas 3 and 5) counts for nothing.

### 3.10 The portfolio study — is the shipped set the best set? (2026-09-21)

Run by an independent agent as `supabase/functions/agents/backtest_portfolio.ts`
(imports `run` / `runRotation` / `COSTS` / the stops; a `runSized` copy is
checked against `run` to the digit — 20 sleeve checks and 68 mark checks,
all zero difference — for the two things `run` cannot express, §3.9's regime
gate and per-entry sizing). Report, verbatim:
`docs/agents/reviews/2026-09-21-portfolio-study.md`; raw
`docs/agents/backtests/portfolio.json`. Two windows, never averaged: A =
the last third out (2025-09 → 2026-09, the bear year every earlier table
reports), B = the middle third out (2024-09 → 2025-09, a bull year). The
verdicts, under the bar and nothing further:

1. **No member of the shipped set clears the bar on both windows** — not one
   of 21. Four clear A (trend-4h on SOL and AVAX, both venues), thirteen
   clear B (trend-4h BTC / ETH / SUI, momentum BTC / ETH / SOL, trend-1h
   ETH, on both venues); the lists share nothing. The one member of 39
   tested that clears both is a candidate, not a shipped row:
   `regime-trend-4h·revx·LINK` (A +2.0 %, DD 17 %, plateau 93 %; B
   +27.2 %, DD 15 %, 100 %) — one pass in 78 looks is inside chance.
**Corrected 2026-09-21 by §3.11**: this study called `runRotation`
before that function took stops, so every rotation figure in it is the
BARE RANK RULE, not the rows the loop runs. `rotation-1d·revx` window A
reads −16.2 %, not −14.4 %; window B +199.1 %, not +237.7 %; the Kraken
row −13.2 % / +86.8 %. At set level the difference is small (A −5.3 %
against −5.4 %, B +36.9 % against +38.8 %) because the two rotation rows
move opposite ways in the bear year. Everything else in §3.10 stands.

2. **The shipped set on its $400 deployable** (row capital is $440; the
   $20 order cap leaves $20 of each rotation row undeployable): **A −5.4 %,
   DD 25 %, ret/DD −0.22; B +38.8 %, DD 12 %, ret/DD 3.19**, against
   equal-weight holding BTC/ETH/SOL/XRP at −46.7 % / +178.1 %. Revolut X
   rows alone: −3.5 % / +43.5 %; Kraken rows alone: −7.6 % / +33.0 %.
3. **Every Kraken twin is correlated 0.92–1.00 with its Revolut X row and
   earns strictly less** (40 bps a side). They measure Kraken's fill and
   fee against the same signal — which is what they were seeded for — and
   nothing else; they hold 45 % of the paper capital. trend-1h and
   momentum-1d are NOT redundant with trend-4h (same-coin correlations
   0.4–0.7); nothing in the set duplicates anything but its own twin.
4. **Parameter stability**: the seeded trend-4h point is on a plateau in
   both windows on AVAX (85 / 67 %) and SUI (85 / 70 %) only; BTC (0 / 93),
   ETH (7 / 100) and SOL (100 / 22) collapse in one window each. trend-1h is
   on a plateau in both windows on no coin. The rotation's seeded point is
   mid-grid in both.
5. **The stops are not on a plateau**: (8 %, 3×ATR) ranks a median ~10th of
   16 across the ten coin-windows; the floor is inert on BTC and AVAX in A
   (the trail always fires first); on SUI in A the shipped pair is the worst
   of 16. A 4× trail or none beats 3× on 8 of 10 coin-windows. **Not
   changed**: choosing a stop on the same two years it is scored on is the
   fit the bar exists to refuse; written down as what paper should watch.
6. **The regime filter (§3.9) clears both windows on LINK, NEAR, SUI and
   ALGO** (AAVE too, but for its $54k book) where the baseline clears SUI
   alone — by holding less, and three passes in ~1,500 looks is inside
   chance. §3.9's next step (the middle third agreeing, then a paper twin)
   is now met on those four: a paper twin is the step, when Davies says.
7. **Kraken-only candidates: POL, by liquidity alone** (+6.6 % / +14.2 % on
   Kraken costs, plateau 100 / 52 %, DD 7 / 11 %; UK book $11k a day; 2.05
   years of history, so its thirds are 8-month slices). No coin clears on
   Kraken costs while failing on Revolut X costs.
8. **Volatility-scaled slots are a dial, not an edge**: A −3.9 % (DD 22 %),
   B +34.8 % (DD 11 %); return / drawdown unchanged; turnover −10–16 %.

Caveats are the report's own, all of them: one bear year and one bull
year, each a single draw; the same year judges the point and its
plateau; 7–40 trades a window; the coins move together; ~4,000 looks at
two years; short histories flagged (HYPE 0.6 y, POL 2.05 y); spreads one
snapshot; the model is not in the backtest; paper decides.

### 3.11 Where the money should sit — the allocation study (2026-09-21)

> **Re-run 2026-09-21 after the duplicated intra-bar trail was removed
> (§3.13, §4.11).** `allocation.json` is regenerated; every figure below
> was produced under the old stop and is kept because the change to it is
> the finding. **Every ranking and every conclusion is unchanged** — the
> same plan wins on the worse window, no weighting beats equal slots on
> both windows, no row change helps both — and every number is better:
>
> | | old | re-run |
> |---|---|---|
> | recommended sleeve, window A (bear) | −0.3 %, DD 11.8 %, ret/DD −0.03 | **+8.0 %, DD 11.3 %, ret/DD 0.71** |
> | recommended sleeve, window B (bull) | +12.6 %, DD 10.2 %, 1.24 | **+20.1 %, DD 10.5 %, 1.92** |
> | deployment A / B | 6.5 % / 11.3 % | 8.8 % / 14.4 % |
> | turnover A / B | 19.0× / 25.9× a year | 16.5× / 21.8× |
> | the shipped seven rows, $400 | −0.22 / +3.00 | −0.03 / +3.65 |
>
> The bear window is the one that matters for the decision, and it moves
> from "roughly flat" to **+8 %**. Capital per coin (point 1): equal slots
> is now −0.03 / 3.65 and still nothing beats it on BOTH windows —
> inverse-volatility −0.12 / 4.03, per-entry scaling +0.02 / 3.29 and
> concentration −0.09 / 4.19 each win one and lose one, equal risk is
> identical to equal slots to the digit, and both evidence arms still lose
> on both. Row plans (point 2), best worse-window first, unchanged in
> order: trend-4h alone **+0.71 / +1.92**, both venues +0.66 / +1.52,
> trend-4h + momentum +0.20 / +3.83, Revolut X without rotation +0.20 /
> +3.12, drop the rotations +0.11 / +2.89, Revolut X only +0.02 / +4.38,
> the shipped set −0.03 / +3.65, Kraken only −0.07 / +2.90, row capital by
> prior evidence −0.25 / +3.27 and still the worst plan tried.
> **Leave-one-out (point 5) is where the correction bites hardest**: in the
> bear window AVAX now returns **+34.1 %** on its own slot and is the most
> expensive coin to remove (ret/DD −0.56 without it), SOL +17.6 %, SUI
> turns from −10.5 % to +1.4 %, and in the bull window **AVAX is +6.8 %
> where it was −3.3 %** — so AVAX is positive on BOTH windows for the
> first time, on the parameters the loop actually runs. Nothing is added
> or removed on that basis: one re-run is not a bar (§4.15), and the
> third-window study is the test.

Davies: live is now all-or-nothing, so the whole set has to be the best
set, and "每个币不一定都投入一样的钱" — the coins need not get equal
money. Run by an independent agent as
`supabase/functions/agents/backtest_allocation.ts` (imports `run`,
`runRotation`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`,
`spreadOf` and `buyHoldBasket` from `backtest.ts`; the one copy,
`runSized`, adds per-entry sizing and a trade log and is checked against
`run` with the extras off — **40 checks, zero difference in return,
drawdown and trades**). Output `docs/agents/backtests/allocation.json`,
report `docs/agents/reviews/2026-09-21-allocation-study.md`. Re-run to a
scratch directory here before integrating: it reproduces its own JSON
byte for byte. Same two windows as §3.10, never averaged.

**1. Capital per coin: equal slots, because nothing beat it on both
windows.** Ranked by return over drawdown, A / B:

| arm | A | B |
|---|---|---|
| equal slots (what runs) | −0.22 | 3.00 |
| inverse volatility | −0.28 | **3.32** |
| equal risk | −0.29 | 3.20 |
| per-entry volatility scaling | **−0.19** | 2.82 |
| weighted by the prior third's return | −0.36 | 2.25 |
| concentrated on the prior third's bar-clearers | −0.37 | 2.95 |
| weighted by the OTHER window (look-ahead) | — | 3.10 |

Two arms win one window and lose the other, which is what ~130 looks
produce. The two evidence arms lose on **both**: in four rows of five
the prior third's best coin is the scored window's worst — window A puts
71 % of trend-4h on ETH, which then lost 10.3 %, and zeroes SOL and AVAX,
which made +13.3 % and +12.1 %. Taking the weights from the other window
instead does not rescue it. And **equal risk is not a separate idea**:
under a percentage floor it is equal dollars exactly, under the ATR trail
it is inverse volatility with a cap. Equal slots survives because it is
the null, not because it won a search.

**2. Capital per row: everything into `trend-4h` on Revolut X.** Thirteen
row plans, ranked by the WORSE of their two windows (ret/DD, A / B):
trend-4h alone **−0.03 / 1.24**; trend-4h both venues −0.03 / 0.80;
Revolut X without rotation −0.10 / 2.43; trend-4h + momentum −0.14 /
3.31; drop the rotations −0.17 / 2.18; Revolut X only −0.18 / 3.68; the
shipped set −0.22 / 3.00; Kraken only −0.24 / 2.32; row capital by prior
evidence −0.30 / 3.09, the worst plan tried, which in the bear window
puts a third of the book into the rotation row on the strength of a
+199 % middle third. `rotation-1w-kraken` is the only row of seven whose
removal improves the set on both windows.

**3. The venue split: Kraken runs no real money, and keeps the job it
already does.** A Kraken round trip costs 80–96 bps against Revolut X's
19.5–53.5 and needs a 0.80–0.96 % gross move. At a 30 %-a-year drift a
Revolut X major pays itself back in 2.4 days and a Kraken one in 9.7
(at 100 %: 0.7 and 2.9); the measured median holds are trend-4h 2.29 d,
momentum 3.42 d, trend-1h 0.60 d. The **median** round trip loses money
before fees on every rulebook; the mean beats a Kraken round trip in 5 of
10 trend-4h coin-windows, 3 of 6 momentum and 1 of 6 trend-1h. The twins
are 0.905–1.000 correlated with their Revolut X rows and 3.0–16.8 points
worse per window, and every Kraken arrangement — all rows, the slowest
rows, trend-4h alone — is beaten by its Revolut X counterpart on both
windows. **No Kraken-only coin today**: POL on the seeded parameters is
+33.0 % / −5.2 % and fails window B on both venues (§3.10's pass used
parameters chosen in sample), and its Kraken 24-hour book has never been
measured, so §4.16's liquidity test cannot be applied to it at all.

**4. Rulebooks: keep trend-4h, drop both rotations, drop trend-1h,
momentum stays paper.** The rotation fails the bar on both windows on
both venues for different reasons — negative in the bear year, drawdown
41.3 % and 42.8 % in the bull, over the 35 % limit — and its own stops
make it worse in three cells of four. trend-1h earns $0.19 and $1.61 on
$40 at 69–87×/y turnover and is on a plateau on no coin in either window;
**its feedback-speed case does not survive contact with the numbers**:
17–21 fills a month against trend-4h's 8–11, a factor of two, and
trend-4h alone reaches ten fills in 27–38 days. momentum-1d is the
biggest bull-year contributor (+62.4 % on its row) and carries a 41 % row
drawdown in the bear year; it is the first row a larger live set would
add and the one that costs most when the year turns.

**5. No coin changes.** Four of nineteen leave-one-out tests improve a
row on both windows — SUI out of `trend-4h·revx` (+0.13 / +0.05, and the
same removal HURTS the Kraken row), BTC out of `trend-1h`, BTC out of
`momentum-1d` on each venue — and nineteen tests scored on the windows
that chose them produce that many by chance. Nothing joins. On Davies'
market-cap question: cap is not the constraint and the book is — SUI
$942k a day and AVAX $1.9m both clear §4.15 — but SUI's 42 bps round trip
needs 5.1 days at a 30 % drift against a measured hold of 1.0–1.25 days,
which is the number to watch on it.

**6. The set, priced.** `trend-4h` · Revolut X · BTC/ETH/SOL/AVAX/SUI ·
$100 · five equal $20 slots · parameters unchanged:

| | window A (bear) | window B (bull) |
|---|---|---|
| recommended set | **−0.3 % (DD 11.8 %, ret/DD −0.03)** | **+12.6 % (DD 10.2 %, 1.24)** |
| the shipped seven rows, $400 | −5.3 % (DD 24.5 %) | +36.9 % (DD 12.3 %) |
| holding BTC/ETH/SOL/XRP equally | −46.7 % | +178.1 % |
| cash | 0 % | 0 % |
| deployment | 6.5 % of the year | 11.3 % |
| turnover | 19×/y | 27×/y |
| peak open / p95 / median | $100 / $60 / $0 | $100 / $80 / $20 |

It fits `max_order_usd` 20 and `max_exposure_usd` 100 with nothing
raised. The named alternate, plus `momentum-1d·revx` at $40, is
−2.5 % / −0.14 and +26.9 % / 3.31 and would need the exposure cap at
$140. **Read the deployment row**: in the bear year this rule is in the
market 6.5 % of the time. It is mostly a way of being in cash.

Caveats are the report's own, all of them, and the sharpest is that the
recommendation is chosen by the worse of two windows, which is one number
from each of two single draws; a third window could reorder the table.

### 3.12 Kraken, now that it can trade — the venue study (2026-09-21)

Davies converted the Kraken account to USD and set a nonce window on the
key, which removed the two reasons Kraken COULD not trade and left the
question of whether it SHOULD. §3.11 had answered "no" for the rules it
runs; this asks the harder version: is there a rulebook, a holding
period, a coin or a fee tier at which 80–96 bps a round trip pays for
itself? Run by an independent agent as
`supabase/functions/agents/backtest_kraken.ts` (imports `run`,
`runRotation`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf` and
`resample`; the trend rule on daily and weekly bars and the slow rotation
need NO copy — they are `run` and `runRotation` with different arguments
— and the one copy, `runLogged`, is checked against `run` on **60 checks
at zero difference**). Output `docs/agents/backtests/kraken.json`, report
`docs/agents/reviews/2026-09-21-kraken-study.md`. Verified before
integrating: the re-run reproduces its JSON exactly apart from the live
book reading, and the harness re-derived §3.11's recommended set, §3.11's
Kraken twin, the 7-day rotation seed and §3.8's two-window clearers
without being told any of them.

**1. A slower rulebook does fix the cost and destroys the sample doing
it.** Seven rulebooks (the shipped 4-hour rule; the same with slow
200/300, breakout 100/200 and ATR 4/6; a daily trend including the
200-day; a weekly trend; Donchian on daily and on weekly closes;
3/6/12-month momentum) over 27 coins and two windows:

| | shipped 4h | the slow rulebooks |
|---|---|---|
| median hold | 3.2 d | 9.5 / 14.0 / 21.0 / 35.0 d |
| Kraken break-even at a 30 % drift | 9.73 d | cleared |
| fee, % of the slot a year | 7.81 % | 1.15–1.85 % |
| trades a window | 5–20 | **1–5** |
| coin-windows with no trade at all | — | **51 of 353** |

**And the count that decides it: 12 two-window passes where chance alone
gives 14.6.** Fewer than noise, over 12,492 out-of-sample evaluations.
Five of the twelve rest on a single entry that never closed inside its
window. §3.9's weekly-bar finding is confirmed and extended: a longer
look-back does not rescue weekly bars, and the same is now true of daily
bars, of bare Donchian channels and of 3/6/12-month momentum. A slower
rotation is worse on both windows than the 7-day seed already in paper.

**2. What a round trip needs, and what the mean is worth.** The median
gross round trip is NEGATIVE on all seven rulebooks (−174 to −800 bps).
`trend-4h` clears 96 bps at its 66th percentile, `donchian-1d` at its
81st, `momentum-long` at its 82nd. The share clearing 96 bps is within
four points of the share clearing 20 bps everywhere — the distribution is
bimodal (a floor stop, or a long run), so Kraken's extra 60 bps does not
remove the marginal winners, it is subtracted from all 9.76 round trips a
year (5.9 % of the slot). "The mean beats the cost" is not a
measurement: with a standard deviation of 2,058–6,668 bps the mean's
standard error is 108–1,144, so **t against an 82 bps round trip is 1.33
for `trend-4h`, 0.43 for `trend-1d`, −0.09 for `donchian-1d`, −0.25 for
`momentum-long`** — and 2.17 for `trend-4h-wide`, the one exception.

**3. The fee tier never arrives.** The recommended shape generates $160
of 30-day volume; tier 2 needs $2,500 — 15.6× the turnover, or $1,558 of
capital against an account holding about $100. The slow rulebooks
generate $24–$38, further away. Trading to reach it is an identity
rather than a strategy: $2,500 a month on $100 is 304× turnover a year,
which at the DISCOUNTED 0.30 % maker is **91.2 % of the account a year in
fees**. Re-priced at 0.30/0.60 the twelve clearers gain 0.11 to 2.13
points a window and not one changes side.

**4. Kraken's book, measured for the first time** (keyless `AssetPairs`
plus eleven `Ticker` calls 60 s apart, 20:47–20:57 UTC): all 27 coins in
`COSTS` are listed, **all 27 clear §4.16's $100k a day** (thinnest ETC at
$327k), `costmin` is $0.50 and `ordermin` $2.53–$16.26, so a $20 slot is
placeable on every one. §4.16's liquidity test can finally be applied
there. **Eight coins clear on Kraken while failing Revolut X's UK book**
— BNB, LTC, TON, SHIB, AAVE, ETC, POL, ATOM — and on the seeded
parameters a row would actually run, **zero of the eight clear the bar on
both windows**: POL +33.0 % / −5.2 % and BNB +7.7 % / −17.4 % fail window
B, TON and SHIB fail window A, the other four fail both.

**5. Put nothing on Kraken.** The decisive number is that **Revolut X
beats Kraken in 18 of 18 paired comparisons, both windows, without one
exception** — same rulebook, same coins, same parameters, 60 bps cheaper.
The Kraken rows that do improve the set are the ones the study chose by
looking at the windows it then scored them on; the one Kraken
configuration seeded BEFORE the search, the `trend-4h` twin, makes the
set worse on both windows (−0.4 % / +8.7 % against −0.3 % / +12.6 %).
Nothing in `agent_risk` needs raising — and note that its caps are per
venue account, so even a five-slot Kraken row would have fitted $20 and
$100 without a change. The cap was never the constraint on Kraken; 80 bps
is.

**What would change this**, in either direction: a third window, a
sideways year, on which `trend-4h-wide` holds up on SOL and AVAX (the one
rulebook whose mean clears a Kraken round trip at t > 2 and whose passes
are 7–19 trades wide rather than one); a fee tier reached by capital the
account actually has rather than by turnover; a quarter of paper in which
the Kraken twins' FILLS beat the backtest's post-only assumption, which
is the one thing a backtest cannot see and exactly what the twins were
seeded to measure; or a coin Kraken lists and Revolut X's UK book cannot
carry that clears the bar on both windows on SEEDED parameters — POL is
the nearest and it is 26 points away from itself.

**A cost correction.** Kraken's measured LINK spread is 3.03 bps today
against `COSTS`' 0.10: §3.8's twenty-minute window caught an unusually
tight moment. `COSTS` now carries the WIDER of the two measurements,
because a cost assumption should not flatter. Every study JSON committed
before 2026-09-21 21:15 UTC charges the tighter one, so their
LINK-on-Kraken figures are about 3 bps optimistic on a round trip, which
changes nothing against 80 bps of fee. The other 26 agree within a basis
point or two.

**Does Coinbase's series stand in for Kraken's price?** Nothing had ever
answered that for Kraken. Median |Δclose| over ~710–719 overlapping
4-hour bars is 0.93–1.33 bps on BTC / ETH / SOL / XRP and 3.42–6.11 on
LINK / AVAX / SUI / NEAR (p95 3.2–22.9). Small against 80–96 bps of cost.
Kraken's own quarterly OHLCVT bundle (§2b) has still never been pulled;
it is the right source for the next round.

Caveats are the report's own, all of them, and the first is that the
whole study is a search scored on the windows it searched — which is why
the chance column is the control and why the answer is no.

### 3.13 Execution and trade management — the study that found a stop running twice (2026-09-21)

Davies asked four things: Revolut X's maker side is 0 %, so can every
order rest and pay nothing; are the two per-minute stops right; is the
two-bar cooldown right; and is all-in / all-out of a coin's fixed slot
really best. Run by an independent agent as
`supabase/functions/agents/backtest_execution.ts` (imports `run`,
`resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf`; the one
copy, `runExec`, adds resting execution, a stop anchor and time stop,
tranches and per-fill bookkeeping, and is checked against `run` with
every new branch off — **60 checks, zero difference in return, drawdown,
trades, exposure and fees**). Output `docs/agents/backtests/execution.json`,
report `docs/agents/reviews/2026-09-21-execution-study.md`. Re-run here to
a scratch directory: byte-identical. Two windows, never averaged.

**The finding that matters is not a parameter — it is that the ATR trail
is implemented twice.** `ruleDecision` exits when the CLOSE falls
`atrStop × ATR(14)` below the high-water mark
(`_shared/agents_strategy.ts`), and the protective stop exits when the
bar's LOW — the live mark, every minute — falls below the same level
computed from the same anchor with the same multiplier
(`backtest.ts` `run`, `tick.ts`). Same trail, same parameter, two price
series, and the intrabar copy always fires first, because any bar that
closes through the level traded through it first. It takes **48 of 49
protective exits in window A and 67 of 68 in window B**; the rulebook's
own trail is very nearly dead code. Nobody designed this — it is what two
correct implementations of one idea look like when they meet.

Verified here independently of the study's own combiner, calling `run`
directly on the five live coins with the seeded parameters and Revolut X
costs (`stopsHit` in brackets):

| coin · window | shipped (8 %, 3× intrabar) | intrabar trail off, 8 % floor |
|---|---|---|
| BTC · A | −13.6 % (16) | −10.7 % (0) |
| BTC · B | +17.0 % (20) | **+12.4 % (1)** |
| ETH · A | −10.3 % (12) | −8.0 % (0) |
| ETH · B | +49.4 % (14) | +80.1 % (1) |
| SOL · A | +13.3 % (7) | +17.6 % (0) |
| SOL · B | −10.9 % (16) | +3.0 % (3) |
| AVAX · A | +12.1 % (5) | +34.1 % (0) |
| AVAX · B | −3.3 % (12) | +6.8 % (1) |
| SUI · A | −10.5 % (8) | +1.4 % (2) |
| SUI · B | +3.0 % (5) | **−2.5 % (3)** |
| equal-weight mean | A **−1.8 % → +6.9 %**, B **+11.1 % → +19.9 %** | |

Better on **8 of 10 coin-windows**, worse on BTC · B and SUI · B. Turning
the intrabar trail off does NOT remove the trail — `ruleDecision`'s
close-based one is untouched and takes over — and does not touch the hard
floor, which is still read against the low every minute
(`level = max(floor, −∞)`). It stops the rule selling into wicks.

**The study also proposed widening the floor 8 % → 10 %, and that part
does not hold.** On the same independent run it is better on 2
coin-windows, worse on 4 and identical on 4; its entire contribution is
SUI · A (+1.4 % → +33.7 %), one cell of ten. That is a single-coin
artefact and the floor stays at 8 %.

The other three answers, all negative, which is the useful kind:

- **Maker-only execution does not get you a free account.** Resting
  everything beats the 9 bps taker on both windows under the loop's own
  fill model, but decomposed against a synthetic 9 bps maker fee the fee
  itself is worth only +0.9 / +1.2 points; the rest is a lower entry
  price dodging the duplicated stop above. Once that stop is corrected
  the maker edge is **+1.64 in A and −0.19 in B — a one-window win** — and
  the whole result reverses if a filled bid needs 20 bps of adverse move
  rather than 0 (break-even between +10 and +20 bps through the bid).
  The model says the bid fills with a **median delay of zero hours on
  every coin in both windows**, which is the model's limit and not a
  measurement: these are Coinbase candles with synthetic bid and ask, and
  nothing here knows whether a resting order on Revolut X's UK book fills.
  **Execution stays marketable.** What settles it is a measurement on the
  real book, and that is now built: **migration `0042`, the maker probe.**
  Every time the loop crosses the touch it also writes down where a
  post-only order WOULD have rested — the same side's touch — and later
  turns resolve it against the execution venue's own last closed minute
  (did the book come back to that price, and after how many minutes) and
  then record the mark **15 and 60 minutes after it resolved**. The gap
  between that mark and the probe's price IS the adverse selection, in
  bps, on the real UK book, to be read against the 10–20 bps break-even
  band above. A probe is never an order: nothing reads it into a position,
  a book, an exposure or a P&L, it is written last so a probe that fails
  to insert can never cost an order, and it costs one extra public
  minute-candle call only on a symbol the loop has just traded. It needs
  no live money and is collecting from the next tick. Read it as: fill
  rate by symbol, median `minutes_to_fill`, and the follow-up marks
  against `maker_price`. Pinned by `tick.test.ts` (`probeFilled`,
  `probeFollowUpDue`, and three end-to-end cases).
- **The two-bar cooldown stays.** The 0–8 grid spans 1.1 points of return
  in the bear window; 2 ranks 5th of 7 in A and 4th of 7 in B — a flat
  plateau, not a spike — 0 and 1 are inert, and 3 arms of 6 pass against
  1.5 by chance (p = 0.17). Nothing to win here.
- **All-in / all-out stays.** Scaling out at a profit target loses on both
  windows in all four forms; scaling in on pullbacks loses on both in all
  three; pyramiding wins on both but by +0.9 points in the bear window,
  3 passes of 11 arms against 2.75 by chance (p = 0.54), and becomes a
  −2.5-point loss once the stop is corrected.

**Multiple comparisons, study-wide: 150 of 262 arms beat the shipped
configuration on both windows where a coin-flip null gives 65.5** — and
that table is the wrong number to read, which the report says itself: the
215-arm stop grid is ONE idea, and all 15 of the interaction arms contain
it. The two searches whose arms genuinely differ, the cooldown and the
sizing, are the two that land inside chance. The load-bearing evidence is
that ten settings chosen on window B and scored on window A all beat the
shipped pair out of sample, worst of the ten 0.70 against −0.03.

Caveats are the report's own. The sharpest: **neither window contains a
gap-down crash**, so the case for keeping any intrabar stop rests on the
absence of evidence rather than on these numbers; no setting in the
216-point grid produced a drawdown above 13.6 %, which is itself a sign
the windows are gentle. Resting the protective SELL was the best arm in
the table and is not recommended on hourly candles, which cannot show a
fall in which no bid returns. AVAX's and SUI's Revolut X
`min_order_size_quote` have never been read (§6's probe covered BTC / ETH
/ SOL), so every claim that a tranche would be a legal order on those two
is an assumption. And re-quoting at the loop's real cadence cannot be
modelled at hourly resolution.

**Shipped 2026-09-21**, on Davies' word once the mechanism was verified:
`tick.ts` and `SHIPPED_STOPS` carry `atrStop: null`, the rulebook's
close-based trail is untouched, the 8 % floor is untouched, and
`stopsForKind` returns the floor alone for every rulebook. Pinned by
`backtest.test.ts` and `tick.test.ts` — and fixing those pins was itself
evidence: one asserted "a slot through its 8 % floor is sold" on a series
whose floor sat 75 % below the market, so the exit it measured was the
trail. The test named the floor and measured the trail, which is the same
confusion the loop had. §3.3a is re-run; the floor turns out never to have
fired on BTC, ETH or SOL out of sample.

### 3.14 Kraken pushed as far as it goes, the TESTING rows judged, and a problem with the tape (2026-09-21)

Davies asked for three things: keep looking for a standalone Kraken
strategy, give every TESTING row a verdict with a number behind it, and
propose anything worth adding. Run by an independent agent as
`supabase/functions/agents/backtest_kraken2.ts` (imports `run`,
`resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf`; the one
copy, `runLogged`, adds a per-trade log and is checked against `run` —
**252 cells, zero difference** in return, drawdown and trades, plus 28
more with §3.9's regime gate switched off, also zero). Output
`docs/agents/backtests/kraken2.json`, report
`docs/agents/reviews/2026-09-21-kraken-standalone-study.md`. Re-run here
to a scratch directory: identical apart from `ran_at` and
`runtimeSeconds`. It was launched before the stop correction, caught it
mid-flight and re-ran everything against the corrected build; §7 of the
report is a before/after table, and the numbers below are all post-
correction.

**The problem with the tape comes first, because it is the one that
touches everything else.** The study ran the same seeded rule over the
same calendar on Kraken's own 4-hour tape and on the Coinbase series
every earlier table in this reference used. Over 36 comparisons the
median absolute difference is **2.5 points** and the maximum is **68**
(ALGO window B: +79.9 % on Kraken's tape against +147.9 % on Coinbase's,
**on twelve trades each**), with 2 sign flips. Verified here
independently, calling `run` directly on the five live coins with the two
tapes clipped to the same span, Revolut X costs, shipped stops:

| coin · window | Kraken tape | Coinbase tape | Δ |
|---|---|---|---|
| BTC · A / B | −8.5 % / +15.2 % | −9.5 % / +7.7 % | +1.0 / +7.6 |
| ETH · A / B | −19.0 % / +56.5 % | −20.1 % / +57.1 % | +1.1 / −0.6 |
| SOL · A / B | −4.2 % / −1.1 % | −0.5 % / +0.1 % | −3.6 / −1.3 |
| **AVAX · A** | **−1.3 %** | **+20.6 %** | **−21.9, sign flip** |
| AVAX · B | +20.2 % | +11.5 % | +8.7 |
| **SUI · A** | **+37.5 %** | **+8.4 %** | **+29.2** |
| SUI · B | +26.5 % | +26.7 % | −0.1 |
| **five slots, equal weight** | **A +0.91 %, B +23.48 %** | **A −0.22 %, B +20.62 %** | **+1.1 / +2.9** |

Two things follow, and they point opposite ways. **At sleeve level the
recommendation is robust**: swapping the entire price series moves the
bear window 1.1 points and the bull window 2.9, same sign, same order of
magnitude, so which tape you use does not change what to run. **At coin
level nothing is robust**: AVAX's bear-year return, the single number
that justifies its seat in every leave-one-out table, is +20.6 % on one
tape and −1.3 % on the other. The five slots cancel what the individual
coins cannot agree on — which is the case for holding five of them, made
by accident.

**This matters because `signal_venue` is `kraken`.** The live loop reads
Kraken's candles and executes on Revolut X (`0037`, every row); every
published table reads Coinbase's. So the backtests have been pricing a
signal the loop does not compute. At sleeve level that is worth about a
point; at coin level it is worth up to thirty, and §4.15's bar — four
tests per coin per window — is being applied at exactly the level where
the measurement is least stable. **Closed 2026-09-22 by §3.16**, which ran that
study. The gap is real and large — median 4.03 points, p95 31.3, max
70.4 over 288 comparisons, 9.0 % sign flips — and it has **no
direction**: Kraken's tape is higher in 149 cells and Coinbase's in 139,
p = 0.596, and p = 0.690 counted once per coin. So the reference is NOT
re-priced wholesale, because re-pricing something that disagrees randomly
buys nothing; the two load-bearing tables are re-priced there and neither
verdict moves. The labelling was what was wrong, and that is what
changed.

**K1: no, and more firmly than §3.12 said it.** Six rulebooks built for
the constraint (monthly rebalance, a 200-day regime hold, wide Donchian,
a crash-stop hold, `trend-4h-wide`, the shipped trend rule) over **68
coins**, reached by measuring 622 online Kraken USD pairs keylessly and
keeping the 199 whose book clears $100k a day. In **952 coin-window
cells the Kraken figure beats the same rule at Revolut X's fee schedule
exactly zero times.** Twelve arm-coin pairs clear both windows against
**16.28 expected by independence alone**, and eight of their twenty-four
cells rest on two or fewer closed round trips. Slowing down does fix the
arithmetic — the monthly rebalance holds a median 10.25 days, which
breaks even at a 31 %-a-year drift against the shipped rule's 3.33 days
and 106 % — and destroys the sample doing it: 2–4 closed round trips a
window, and 40 of 136 cells on the wide Donchian never trade at all. No
arm's pooled mean round trip clears the 89.5 bps it has to at t > 2;
`trend-4h-wide`, §3.12's one exception at t = 2.17 over 27 coins, reads
**1.77** over 68. The fee tier still needs 26–155× the turnover. §4.16's
named candidates are answered: **ZEC, XMR and TRX each clear one window
on one rulebook and none on both.** PAXG (tokenised gold) clears three
rulebooks on 0–4 closed round trips and is recorded, not proposed.

**K2, the TESTING rows, each with the number behind it:**

| row | verdict | why |
|---|---|---|
| `trend-1h·revx` | **delete** | $1.51 / $4.08 on $40 at 62–76×/y; worst row on the worse window (ret/DD 0.20 against the live row's 0.71) and worse in each window separately; on a plateau on no coin; its best of 108 variants loses 9.2 % on the first window it meets. Its stated job was feedback speed: 46–56 fills per 90 days against the live row's 20–27 — a factor of two, for a row that earns nothing |
| `momentum-1d·revx` | **keep, do not optimise** | the only rule whose P&L is not a restatement of another row's (≤0.72 / 0.64 against non-twins, 0.46 / 0.60 against the live row). +$24.97 on $40 in the bull window against a 41.0 % bear drawdown. Its best of 32 variants turns +44.9 % into **−12.3 %** out of sample |
| `momentum-1d·kraken` | **delete** | 0.999 / 1.000 correlated with its twin and 12.1 / 8.8 points worse; the fill-measuring job is already done by `trend-4h·kraken` |
| `trend-4h·kraken` | **keep, stop reading its return** | the only row measuring the LIVE rulebook's fills on the second venue, 20.1 / 26.8 fills per 90 days. Its return is a fill-path accident (+0.59 points *ahead* of its twin in A, 6.48 behind in B, r = 0.966 / 0.999) |
| `rotation-1d·revx` | **delete** | fails the bar on both windows (−13.3 %; 37.0 % drawdown, over the 35 % limit). Best of 54 variants chosen out of sample: +105.4 % on the middle third, **−66.0 % with a 93.6 % drawdown** on the last |
| `rotation-1w·kraken` | **delete** | 0.905 / 0.939 correlated with the row above; its own optimisation reaches **−75.2 %, drawdown 116 %** |

Not one row's optimisation earns its search: the three that stay positive
out of sample are still worse than the seeded row they came from.

**K3, three candidates, none of them a result on its own:**
`regime-trend-4h·revx` on **LINK and NEAR** (§3.10 point 6's candidate,
not displaced but narrowed — and the set MOVED with the stop change, from
NEAR/SUI/ALGO to LINK/NEAR, which is itself a warning; 2 of 8 clear both
windows against 2.50 by chance, proposed only because §3.9's written
promotion condition is met and paper is the step);
`trend-4h-wide·revx` on **AVAX and SOL** (2 of 8 against 2.25 by chance,
but a median hold of **7.67 days** against the live rule's 2.29–3.33 —
the only shipped-rulebook variant whose hold clears break-even on both
venues, and paper would measure the execution problem a backtest cannot:
orders resting for days and a wide trail across weekends); and,
conditionally, `trend-4h-wide-kraken` on **AAVE** in place of
`momentum-1d-kraken` (Kraken book $5.5m a day, UK book $54k, clears both
windows +14.8 % / +2.0 % on a 100 / 75 % plateau; the return case is at
chance and the job is exercising §4.16's single-venue path, which has
never been used).

**What the study could not settle**, in its own words and worth reading
before acting on any of it: whether `trend-4h-wide` has anything at all
(t = 1.25 → 1.77 → 2.17 depending on the stop and the universe — it sits
exactly where a third window would decide it); whether any individual
coin pass is signal, since the stop change alone kept only **five of the
ten** passes the first run found with no rule, coin or window altered;
which tape is right; that five core coins (BNB, HBAR, HYPE, POL, TON) are
missing from the widened universe for want of three years of Kraken tape,
so §3.12's POL finding is NOT re-tested here; that the null trades less
than the arms it controls, so it bounds manufactured passes rather than
matching them; and that Kraken's book is twelve samples of one evening.

### 3.15 A third window, and the end of the one-window argument (2026-09-21)

Two windows are two single draws. Davies' question — if one window earns
a coin a paper seat, why not the other ten coins that cleared one? — is a
question about whether "cleared one window" carries information, and that
can be answered with a third window rather than with a rule. Run by an
independent agent as `supabase/functions/agents/backtest_windows.ts`
(imports `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`,
`spreadOf`; the one copy, `runGated`, adds §3.9's regime gate and is
checked against `run` with the gate off — **190 cells per stop rule, zero
difference**). Output `docs/agents/backtests/windows.json`, report
`docs/agents/reviews/2026-09-21-third-window-study.md`. **Re-run here:
byte-identical** — it writes no wall-clock field at all. It also
SHA-256s `backtest.ts` at the start and end of a run and writes the hash
into the output, so a run that straddles an edit throws; the hash
`31d27c7d82f8a94c…` matches the committed file. Launched before the stop
correction, it caught the change itself when a determinism check failed,
and **the whole study now runs twice, once per stop rule**
(`perStopRule.shipped` and `.trail`), never averaged. `shipped` is the
headline because it is what `tick.ts` runs.

**The third window is real history, not an extrapolation.** Kraken's free
quarterly OHLCVT bundle was reachable — `Kraken_OHLCVT_Full_2026Q2`,
8.97 GB, 12,037 pairs — and its bars are spliced strictly BEFORE each
coin's Coinbase series, so windows A and B keep the exact candles every
published table used. Two checks say the splice is honest: the overlap on
~2.7 years per coin is **1.83–11.30 bps median, 6.88–46.24 p95**, against
thresholds (median ≤ 25, p95 ≤ 100) written down *before* the comparison
— all 27 coins passed, none dropped — and pricing the seeded rule on
Coinbase-only versus spliced boundaries moves **100 cells by 0 / 0 / 0**.
Its harness reproduces §3.8's own published table under `trail` on 33 of
35 rows, **worst |Δ| 0.0004** where the document rounds to 0.0005; under
`shipped` the worst is 0.1766 and no row is within a tenth of a point,
which IS the size of the stop change.

**The regimes, measured, and the fourth window that matters more than the
third.** A −39.4 % (bear), B +72.3 % (bull), **C +243.0 %** — so C is a
*stronger bull*, not a new regime. The study also built the sideways year
§3.12 asked for as **window D, −5.8 %** (21 coins), reported throughout
and never folded into a three-window count. The live candidate across all
four, seeded, Revolut X, shipped stops:

| window | regime | sleeve return | drawdown | ret/DD | deployed |
|---|---|---|---|---|---|
| C | +243 % | **+55.6 %** | 7.3 % | 7.57 | 17.3 % |
| B | +72 % | +20.1 % | 10.5 % | 1.92 | 14.4 % |
| A | −39 % | +8.0 % | 11.3 % | 0.71 | 8.8 % |
| **D** | **−6 %** | **−7.8 %** | **15.5 %** | **−0.50** | 7.9 % |

**The sideways year is the only one this rule loses in, and it carries
its largest drawdown.** That is what a trend rule does in a market that
goes nowhere — whipsawed in and out — and it is the first time this
repository has a number for it. Read the four together: the rule is long
volatility and direction, and the bear year it survives is a *trending*
bear.

**W3, and the answer to Davies' question. Zero or one coin of 22 clears
the bar on all three windows, against a null of 0.33–1.50, on every
venue × parameter × stop-rule combination:**

| arm | clearers A / B / C | all three | null expects | P(≥ observed) |
|---|---|---|---|---|
| Revolut X, chosen | 4 / 10 / 4 | 1 (SOL) | 0.33 | 0.301 |
| Revolut X, seeded | 5 / 11 / 7 | 1 (AVAX) | 0.80 | 0.602 |
| Kraken, chosen | 6 / 12 / 4 | **0** | 0.60 | 1 |
| Kraken, seeded | 7 / 13 / 8 | 1 (AVAX) | 1.50 | 0.850 |

The null is stated exactly, not sampled: each window's clearers are an
independent uniform subset of the size that window actually produced, and
the distribution is hypergeometric. The whole histogram matches it —
observed {0 windows: 9, 1: 9, 2: 3, 3: 1} against {8.03, 10.26, 3.37,
0.33}. **11,915 arms per stop rule, 23,830 in total, and not one arm
clears three windows more often than chance.**

**A one-window pass predicts nothing, and if anything predicts
backwards.** Verified here directly from the membership lists rather than
from the study's summary — for every coin, did clearing window A predict
clearing window B?

| stop rule · parameters | cleared A → also cleared B | did NOT clear A → cleared B |
|---|---|---|
| shipped · seeded | **1 of 6 = 0.167** | **11 of 18 = 0.611** |
| shipped · chosen | 1 of 5 = 0.200 | 10 of 19 = 0.526 |
| trail · seeded | **0 of 5 = 0.000** | 10 of 19 = 0.526 |
| trail · chosen | 1 of 5 = 0.200 | 8 of 19 = 0.421 |

In all four, a coin that cleared window A was *less* likely to clear
window B than a coin that failed it. The study's own correlations say the
same and refuse to say it strongly: A→B Pearson −0.262 (seeded −0.414),
A→C **+0.438**, B→C −0.151 — the sign flips between pairs, and no
contingency test reaches p < 0.05 at n = 22. **So the honest statement is
that "cleared one window" is a coin flip at best, and the four tables
above are why no coin is joining anything on a one-window record — not
POL, and not the ten others.** Of the 14 recorded cohort members, 4 clear
window C on chosen parameters and 4 on seeded: the same rate as the
population they were selected out of.

**Cohort membership itself moved with the stop.** Re-derived from this
run: under `trail` the two-window list is SUI (chosen) / nobody (seeded);
under `shipped` it is SOL (chosen) / **AVAX** (seeded). SUI leaves it and
AVAX enters. §3.8's "only SUI and POL cleared both windows" is a
statement about a stop the loop no longer runs.

**SUI and POL, answered.** SUI **has no third window** — it did not exist
before 2023-05, and no source can supply one; probed below the declared
180-day in-sample floor and counted nowhere, window C reads −17.2 % on a
0 % plateau, and under the shipped stop SUI does not clear two windows
either. **POL fails window C on both venues and both parameter sets, on a
0 % plateau** (Kraken −20.6 % / −18.8 %). The question of a paper seat for
POL is closed by its own numbers rather than by an argument about rules.

**W2, AVAX.** Seeded: C **+126.7 %**, A +34.1 %, B +6.8 %, D **−29.5 %**.
Under the shipped stop it is the only one of the five clearing A, B and C
— and the sleeve's worst member in the sideways year. Leave-one-out
(positive = better without it): C −2.35, A −0.56, B +0.13, **D +0.57**.
So AVAX pays for its seat in three windows out of four and is the coin
that hurts most in the fourth. Its three-window pass is also the single
observation the null above expects 0.80 of.

**W4: both written-down candidates are two-window luck.**
`trend-4h-wide` clears all three windows on **SOL and AVAX**, both venues,
both stop rules — the strongest result in the study and still inside
chance (2 against 0.79–2.39 expected, P = 0.17–0.79) — and then window D
prices it: SOL −0.9 % on **two trades a year**, AVAX **−35.0 % with a
37 % drawdown**, over §4.15's limit. The BTC-regime gate keeps **NEAR**
(both rules) and UNI (shipped) of §3.10's four against a null of
1.06–1.34; LINK, SUI and ALGO do not survive. Neither candidate is
promoted.

**What it could not settle**: there is no third window for SUI, HBAR or
HYPE, and no window B for BNB or TON — the data does not exist. Window C
is a stronger bull rather than a different regime, and window D's 21
coins nest inside C's in-sample. The population is 22, so "not
significant" means "not detectable at n = 22", not "absent". Choosing
parameters for A and B without the extension's warm-up while C and D have
it moves the chosen point in 17–24 of 100 cells (median effect 0, worst
0.15–0.46). It did not test whether the stop change is *right* — §3.13
owns that — only that it moves who clears what. Jev is not in the
backtest, and nothing about spreads or books was re-measured.

### 3.16 The tape the loop reads, priced against the tape the tables use (2026-09-22)

§3.14 found that every published backtest here prices a signal the live
loop does not compute: `signal_venue` is `kraken` on every row, so the
loop decides on Kraken's candles and executes on Revolut X, while every
table is priced on Coinbase's. This study measures what that is worth.
Run by an independent agent as
`supabase/functions/agents/backtest_tape.ts` (imports `run`, `resample`,
`COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf`; the one copy,
`runMarked`, adds a mark at every bar because `run` samples equity every
sixth bar at a phase that moves when the array start does — checked
against `run` on **744 cells, zero difference** in return, drawdown and
trades). Output `docs/agents/backtests/tape.json`, report
`docs/agents/reviews/2026-09-22-tape-study.md`. Re-run here:
**byte-identical**.

**The check that makes the rest readable**: its Coinbase arm was compared
with `windows.json` cell for cell — chosen and seeded, own venue and
other venue, return, drawdown and trade count — **4,464 cells, zero
differ**, against a recorded SHA-256 of `windows.json` that matches the
committed file. So the Coinbase arm IS §3.15, not an approximation of it,
and every difference below is the tape and nothing else. Window D is
Kraken bars on both arms by construction and is identical across 168
cells, which is the test that the timestamp mapping is right. The Kraken
bundle against the live `OHLC` endpoint agrees to **0.0000 bps, median
and max, on all 27 coins** over 222 shared bars.

**T1: the disagreement is large, and it has no direction.** 288
comparisons (coin × window × venue costs × stop rule), verified here by
recomputing them from the raw cells:

| | seeded | chosen |
|---|---|---|
| median / p95 / max \|Δreturn\| | **4.03 / 31.3 / 70.4 pts** | 4.80 / 41.3 / 540.0 |
| sign flips | 26 (9.0 %) | 43 (14.9 %) |
| §4.15 verdict flips | 17 (5.9 %) | 38 (13.2 %) |
| Kraken higher / Coinbase higher | 149 / 139, **p = 0.596** | 152 / 136, p = 0.377 |
| per coin | 25 coins, **p = 0.690** | p = 0.230 |

**Neither tape is better.** §3.14's ALGO case reproduces exactly. The
study caught the trap its own data sets: at cell level window A looks
tilted (p = 0.0035), but that is **pseudo-replication** — the same coin
counted four times — and at one observation per coin per window it is
p = 0.690 and every window is null. Nothing predicts the size of the gap
either: the best Spearman is **0.23** (volatility), then trades 0.21,
missing Kraken bars 0.20; books and spreads predict nothing. The tape
also changes which grid point gets CHOSEN in about half of the A and B
cells (46 % / 55 % agreement).

**T2: the recommendation does not change; the per-coin story does.**
`trend-4h` · Revolut X costs · five $20 slots · seeded · shipped stops:

| window | Coinbase (published) | Kraken (the loop's signal) |
|---|---|---|
| C | +55.6 %, 7.57 | +50.9 %, 6.58 |
| B | +20.1 %, 1.92 | **+22.5 %, 2.25** |
| A (bear) | +8.0 %, 0.71 | **+9.2 %, 0.84** |
| D (sideways) | −7.8 %, −0.50 | **−7.8 %, −0.50 (identical)** |

The window that decides the ranking is the one where the two tapes cannot
disagree. Per coin it is another matter: **AVAX's bear year goes +34.1 %
→ +12.6 % and SUI's +1.4 % → +29.1 %**, SOL·B and BTC·C flip sign, and
the coin that costs most to remove in the bear window swaps from AVAX to
SUI. One more thing worth having on the record: under the OLD `trail`
stop the bear window flips sign with the tape (−0.3 % → +6.5 %), so
§3.11's original headline was a tape artefact as much as a stop artefact.

**T3: §3.15 survives both of its findings.** On Kraken's tape, 0–2 coins
of 22 clear three windows against exact hypergeometric nulls of
0.66–1.43; the best arm is 2 against 0.74 expected, P = 0.152, and 0.93
after a Šidák correction for sixteen arms. A one-window pass still
predicts **backwards in all sixteen Kraken-tape arms**: cleared-A →
cleared-B 0.167–0.286 against failed-A → cleared-B 0.500–0.588. The
live arm's two-window list is **AVAX on both tapes**.

**T4, and it is the practical answer: change neither the signal venue nor
the tables' arithmetic — change what the tables CLAIM.** Switching
`signal_venue` to `revx` would delete windows C and D outright (Revolut X
history begins ~2023-08, so §3.15 could not exist), move every decision
onto a book 100–300× thinner, and re-open the two-region trap of §4.14;
it also cannot be tested from a harness, because Revolut X's candles need
a signed call. Re-pricing the whole reference is pointless precisely
because the disagreement has no direction — the two load-bearing tables
are re-priced here and neither verdict moves. What is wrong is only the
labelling, and that is fixed: §3.14 is closed with these numbers, the
sleeve carries both tapes, §4.15 carries the per-coin instability, and
every per-coin figure that decides something names its tape.

**What it could not settle.** **The fill price is still unmodelled**: the
loop decides on Kraken and fills on Revolut X, and no table in this
repository simulates that split — §2c's ≤ 3 bps basis suggests it is
small against 9 bps of taker fee, but suggests is not measures, and this
is the obvious next study. Revolut X's own tape needs a signed endpoint
and is unreachable from a harness. **The repository contradicts itself
about it**: §2.3 says three years of hourly history, `backtest.ts`'s
header says one — only a keyed probe settles that. HBAR drops out
entirely (Kraken listed it after its Coinbase series began), leaving 26
coins with at least one window and **22 with all three, verified
coin-for-coin identical to §3.15's 22**. Only `trend-4h` was re-priced —
not the rotations, momentum, trend-1h, the wide variant or the regime
gate. Kraken's 0–5 missing 4-hour bars per coin are left in, and they
correlate with the gap at ρ = 0.20: a hint, not a finding.

### 3.17 The TESTING set, re-priced on four windows — three rows retire and nothing is added (2026-09-22)

Davies asked for the paper set to be optimised: delete what is pointless,
add what is worth testing, change what should change. Run by an
independent agent as
`supabase/functions/agents/backtest_testingset.ts`. Output
`docs/agents/backtests/testingset.json`, report
`docs/agents/reviews/2026-09-22-testing-set-study.md`. Re-run here:
**byte-identical**. Every row priced at its own capital, its own coins
and its own bar, on all four windows, under both stop rules.

**S1: nothing repairs the sideways year. 0 of 33 gate arms, under either
stop rule** — a realised-volatility filter, a choppiness / efficiency
ratio, requiring the breakout to clear the prior high by a multiple of
ATR, a minimum trend slope, longer confirmation. The reason is one
number: **Pearson(how much a gate refuses, Δ window C) = −0.85.**
Everything that helps the sideways year helps by being out of the market,
and being out of the market is exactly what costs the strong bull. A
trend rule's worst regime is not a bug to be filtered out; it is the
other side of the trade that makes it work.

**S2, every row on four windows** (shipped stops; `trail` in the JSON):

| row | A (bear) | B (bull) | C (strong bull) | D (sideways) | worst ret/DD | plateau A/B/C/D | fills / 90 d |
|---|---|---|---|---|---|---|---|
| `trend-4h·revx` **(live)** | +8.0 % / 11.3 % | +20.1 % / 10.5 % | **+55.6 %** / 7.3 % | −7.8 % / 15.5 % | −0.50 | 100/100/100/**4 %** | 14.6–26.8 |
| `trend-1h·revx` | +3.8 % / 18.8 % | +10.3 % / 16.9 % | +39.7 % / 6.8 % | **+16.2 %** / 5.6 % | **+0.20** | 63/67/100/**96 %** | **31.7–56.1** |
| `momentum-1d·revx` | −8.1 % / **41.0 %** | +62.4 % / 17.1 % | **+106.2 %** / 10.0 % | −7.2 % / 27.9 % | −0.26 | 25/100/100/0 % | 17.8–29.0 |
| `momentum-1d·kraken` | −20.1 % / **51.3 %** | +53.6 % / 19.4 % | +98.8 % / 11.6 % | −18.3 % / 31.6 % | −0.58 | 0/100/100/0 % | 17.8–29.0 |
| `trend-4h·kraken` | +8.6 % / 14.1 % | +13.6 % / 11.8 % | +48.9 % / 8.3 % | −12.4 % / 18.9 % | −0.66 | 85/100/100/0 % | 14.6–26.8 |
| `rotation-1d·revx` | −13.3 % / **37.0 %** | **+128.5 %** / 22.5 % | +82.1 % / 27.2 % | **+9.0 %** / 26.5 % | −0.36 | 0/100/100/22 % | 15.5–24.9 |
| `rotation-1w·kraken` | −9.8 % / **41.5 %** | +77.0 % / 26.8 % | +64.2 % / 32.3 % | −9.6 % / **36.7 %** | −0.26 | 0/93/100/11 % | 11.1–20.3 |

Bold drawdowns are at or over §4.15's 35 % limit.

**The result that reverses a verdict**: `trend-1h·revx`, which §3.14
condemned on two windows, is **positive in all four under both stop
rules** and is the only row of seven with at least half its parameter
grid positive in all four — and it is the best row in the sideways year,
the window that beats everything else. **It is kept, and its return is
still not the argument**, for two reasons the study states itself: one
row of seven clearing every window is exactly what chance gives
(P = 0.29–0.71), and its bear-window edge is inside the error bar of the
input the whole repository is least sure of — +5 bps a fill takes it from
+3.8 % to +0.6 %. It stays as a MEASUREMENT row: 31.7–56.1 fills per 90
days against the live row's 14.6–26.8, ten fills in 16–28 days, and at
0.63 the only row in the set with no near-duplicate anywhere.

**S3: nothing is added.** Three candidates were priced; the best is
inside chance and the other two measure something already measured.
§3.15 had already killed both written-down candidates on the sideways
year.

**S4, the set that results** — shipped by migration `0043`:

| row | venue | coins | capital | slot | mode | why it exists |
|---|---|---|---|---|---|---|
| `trend-4h` | Revolut X | BTC ETH SOL AVAX SUI | $100 | 5 × $20 | **live, on Davies' switch** | the go-live row: +8.0 / +20.1 / +55.6 / −7.8, no window over the drawdown limit, the least cost-sensitive row in the set |
| `trend-4h-kraken` | Kraken | BTC ETH SOL AVAX SUI | $100 | 5 × $20 | paper | the only row measuring the LIVE rulebook's post-only fills on the second venue; its return is a fill-path accident and is not read |
| `momentum-1d` | Revolut X | BTC ETH SOL | $40 | 3 × $13.33 | paper | the second rulebook, 0.46–0.63 with the live row; held in paper by its 41.0 % bear drawdown |
| `trend-1h` | Revolut X | BTC ETH SOL | $40 | 3 × $13.33 | paper | feedback speed, and the only row with no near-duplicate; its return is inside chance and inside the spread error bar |

Retired: `momentum-1d-kraken`, `rotation-1d`, `rotation-1w-kraken`.
**Row capital falls $440 → $280**; live exposure sits exactly at its $100
cap, both paper books fall well under $300, no order exceeds $20 —
**nothing in `agent_risk` moves.**

The number worth sitting with: the shipped seven earn MORE than this set
in both bull windows and **less in the bear one**, because the two
rotation rows and the Kraken momentum twin are precisely what loses
window A.

## 4. Design consequences (decided by the evidence above)

1. **Jev is a decision node, not a strategist.** Code computes indicators, regime, position and risk; Jev sees ≤ 1–2 k tokens of categorical state and answers typed questions; a deterministic risk layer has the last word. Anything else contradicts the vendor's own jaggedness page.
2. **Observe every minute, decide on closed bars.** The loop wakes every minute (pg_cron; one minute is where Revolut X's public token bucket and the Edge budget both stay comfortable): it refreshes both venues' quotes, manages and re-quotes resting orders, checks the protective stops against the live mark, and writes the categorical state on the FORMING bar down when it changes (`agent_observations`) — so the page shows what the market is doing between decisions. Entries still wait for a closed 1h / 4h / 1d bar (the one rule that decided on the minute, the dislocation rule of §3.5, was retired by `0038`). "Every second" would cost nothing on Jev and everything on fees and the 1,000-order cap — §3.6 puts the number on it: below an hour the round-trip cost is the whole result.
3. **Each venue fills the way its fee allows.** On Revolut X every order takes the touch (9 bps): that is the fill the backtests assume, and a bid resting on a breakout fills exactly when the breakout fails (§3.5 measured that adverse selection). On Kraken orders rest post-only at the touch, stops included (at the ask, walked down by the re-quote), because 80 bps a side is not worth certainty at this size.
4. **BTC, ETH, SOL only** — the only pairs on this venue with ≤ 3 bps spreads and real volume. Everything else costs 3–8× more per round trip.
5. **Paper first.** Every strategy runs in shadow mode against live prices, recording the orders it *would* have placed, until its paper record is shown; the switch to live is a per-strategy flag Davies flips, and the first live order requires his explicit confirmation.
6. **Hard, code-enforced caps** the model cannot touch: max notional per order, max open exposure, daily loss limit (kill switch), max orders per day well under 1,000, and a global pause flag in the database.
7. **Record inputs, not conclusions** (the `snapshot-record` lesson): every Jev call's state, questions and answers, and every order's request/response, are stored; P&L is computed in one place from fills and marks.
8. **Two venues, each for what it is good at** (§2b, §2c). Revolut X executes (0 % maker); Kraken supplies the signal (`signal_venue`: its candles are the cleaner series) and runs paper twins whose fills pay its real fee. There is no arbitrage between them at any cadence available here — measured, not assumed — and the basis keeps being recorded so that stays true or is seen to change. Caps in `agent_risk` are per venue account and per mode.
9. **Capital utilisation is a consequence of regime, not a target.** The rotation rule holds the strongest two of four whenever they trend; in a broad bear it holds cash, because the alternative lost 45 % out of sample (§3.4). The switch that makes it always-invested exists and is Davies' to flip, with the number beside it.
10. **Nothing fast, except what the data earned — and nothing did.** A 1,000-order day on Revolut X and 40–80 bps a side on Kraken rule out market-making and cross-venue trading. The fastest rule is the 1-hour trend variant (paper, for feedback speed). The dislocation rule (§3.5: taker entries when Revolut X's touch sat ≥ 15 bps under Kraken) was seeded as a measurement and retired by `0038` after its one trade, which turned out to be the other region's book (§3.5, §4.14): a UK account cannot lift an EEA ask. §3.6 tried 15-minute and 1-hour bars with the loop's own fills: at 15 minutes the best parameters lose on every coin, in sample and out, because ~300 round trips a year at 20 bps each is 60 % of the account. A faster rule is a fee schedule, not a strategy, until data says otherwise.
11. **Stops run between bars, entries do not.** The floor under cost is checked every minute against the live mark and sells without asking the model; an entry is never taken between bar closes. **There is no intra-bar ATR trail, since 2026-09-21** (§3.13): the trail that ran here was the trail `ruleDecision` already applies to the CLOSE, from the same anchor with the same multiplier, and the per-minute copy always fired first — 48 of 49 protective exits in one walk-forward window, 67 of 68 in the other, which made the rulebook's own trail near dead code and cost SOL ten points and ETH four in the year it was not needed. Switching it off is better on 8 of 10 coin-windows; the rulebook's trail now does the work it was written to do, on closes. The floor stays intra-bar and is the crash protection — and §3.3a's re-run shows it never fired at all on BTC, ETH or SOL in the out-of-sample year, so what the tables used to call "the stops" was one stop. A resting exit order never outranks a stop: when the stop fires it is cancelled first (on Revolut X the sale is then marketable; on Kraken a stop already resting at the ask is left to work). A stop is claimed on the minute, so one that lapses is tried again next minute, not next bar. After ANY exit a rule waits two of its own bars before buying again — §3.3a shows why. The backtester runs the same stops and the same cooldown, so the tables describe the shipped rule — true of every rule from 2026-09-20 and of the ROTATION rule only from 2026-09-21, when the pre-live review found `runRotation` had neither and §3.4 was re-run with both (the sentence is left standing and corrected here, so the record shows what was claimed and when it was found wrong).
12. **One turn at a time.** pg_net fires the next minute's tick whether or not the last one finished; a turn takes a lease (`agent_locks`, compare-and-set on its expiry, 55 s) and a turn that finds it held does nothing. The bar claim protects decisions; the lease protects everything else.
13. **The model is asked on entries only.** It can veto one; it never advises an exit, and the seeds, the page and the README say exactly that. A partially filled live order is a position from its first fill (stops and caps see it); a venue-cancelled order that had filled in part is recorded as a fill of that part; a live order that filled on arrival is settled from the venue's own view next turn, fee included — never from the placement reply.
14. **The venue's market data is the account's region, always.** Revolut X keeps two books per pair (UK / EEA) and this account trades the UK one; a quote or a candle from the other book is not a price this account can get, and reading one produced the only trade the dislocation rule ever made (§3.5). Every public call names `region=UK`, a row from another region is dropped, and the probe shows which book the loop is reading. The same discipline applies to any venue that publishes more than one book, and any fact of that kind written into this reference is a requirement on the client with a pin, the day it is written.
15. **A coin joins a rule by a bar written before the numbers, never after.** §3.7's four tests — positive out of sample on Revolut X costs, drawdown under 35 %, at least half the parameter grid positive out of sample, positive on Kraken costs — decided AVAX in and LINK, DOGE, ADA out. §3.8 tightened it: the four tests on BOTH walk-forward windows (parameters on the first two thirds with the last third out, and parameters on the first third with the middle third out), and a Revolut X UK book of at least $100k a day, because a bar judged on one year is itself a fit to that year. Under the tightened bar SUI joined and six one-window passes did not; the same bar applies to the next candidate, and lowering it for a coin that nearly clears it is the overfit the friend's message warns about. The plateau share is reported for every coin and is the number to quote when someone says every strategy is sensitive to its parameters: sensitivity is a spike, robustness is a plateau, and both are measurable. **The bar admits a coin; it does not certify the ones already in.** It is what a NEW coin passes to join a row, and it is not a description of the coins already in one: §3.10 found that of the 21 shipped strategy × coin × venue members **not one clears it on both windows** — BTC, ETH, SOL, SUI and AVAX each clear one window and fail the other, and they disagree about which, which is the entire reason the five-coin sleeve is steadier than any of its parts. The live recommendation therefore rests on the SLEEVE's two numbers (§3.11: −0.3 % in the bear window, +12.6 % in the bull) and on leave-one-out, never on a member's own pass. **AVAX is not an exception to this**; it is the case where the failure happened to be written down, because `0039` added it the morning the bar tightened (§3.8), while BTC and ETH were admitted by §3.7 on spread and book before a second window existed and were never re-read against the tightened bar in the same sentence. Quoting AVAX's failure without BTC's and ETH's is the misreading this paragraph exists to stop. In short: the bar governs ADDITIONS and paper promotions, the sleeve number governs money, and neither is evidence for the other. **And a ONE-window pass is not partial credit — it is noise, measured (§3.15).** With a third window built from Kraken's own history, zero or one coin of 22 clears the bar on all three, against a null of 0.33–1.50, on every venue × parameter × stop-rule arm, and the whole windows-cleared histogram matches the null. Worse for the idea: across all four arms a coin that cleared window A was LESS likely to clear window B (0.000–0.200) than a coin that failed it (0.421–0.611). So there is no ladder from one window to a seat: a coin either clears the bar on the windows it has, or its record is a coin flip, and paper seats are for measuring EXECUTION — fills, slippage, the venue's behaviour — not for letting a one-window coin accumulate a return record it would take years to read. This is the answer to "if one window earns a seat, why not the other ten coins that cleared one": none of them, and the ones already in are in on the sleeve's number, not their own. **There is now a number on how unstable the per-coin test is** (§3.16): swapping the price series for the one the loop actually reads flips this bar's verdict on **5.9 % of coin-windows** (13.2 % on chosen parameters) and moves a single coin's bear-year return by up to thirty points, while moving the five-coin sleeve by about one. The bar is applied where the measurement is least stable and the sleeve is where it is most stable — which is the strongest argument in this document for deciding money at sleeve level and letting the bar only admit.
16. **A coin one venue lacks runs on the other alone.** Davies (2026-09-21): the two venues' strategy lists need not be synchronous — a coin Revolut X does not list, lists only on the EEA book, or lists on a UK book under the $100k-a-day floor may run on Kraken alone, and the reverse holds. Nothing in the loop assumes the lists match: each `agent_strategies` row carries its own symbols (`0039` / `0040` appended to each row separately), the tick works one row at a time and the page reads positions per row. The bar does not move for a single-venue coin: the four tests on both windows on THAT venue's costs and a book on that venue of at least $100k a day. On Kraken the costs are 40 bps maker each side — 80 bps a round trip before the spread, against ~20 on Revolut X for the majors — so a Kraken-only coin needs a larger edge, not a smaller one, and the 4-hour rule is the only rulebook whose trade count can carry it (§3.6). Such a coin joins `trend-4h-kraken` by its own migration, paper first. Candidates are the coins §3.8 could not test on Revolut X (ZEC, XMR, TRX were named there); their Kraken series go through the same script before any is proposed. §3.12 has since measured Kraken's book for all 27 coins and priced the eight whose UK book is under the floor on the SEEDED parameters — what a coin joining the row would actually run (`kraken.json`, `krakenOnlySeeded`). **POL is the only one worth a second look**: Kraken book $2.30m a day, spread 9.0 bps, `ordermin` 50 POL ≈ $5.59, window A **+33.0 %** with a 17.7 % drawdown on a **100 %** plateau over 7 trades, window B **−5.2 %** (DD 19.3 %, plateau 51.9 %, 14 trades). That is one window, not two, so **the bar as written does not admit it and it has not been added**. It is recorded here because its record is the same SHAPE as AVAX's — one window each, the bear one — and the two must not end up treated differently by accident: AVAX sits in a row because Revolut X carries it ($1.9m a day) and POL sits in none because Revolut X does not ($11k a day, a tenth of the floor), which is a liquidity fact, not a verdict on the coin. Whether a one-window coin may hold a PAPER seat to build a record — which is exactly what §3.8 granted AVAX — is a question about the paper rows and Davies' to answer; until he does, POL stays out of every row. BNB, TON, SHIB and ETC each clear one window on Kraken costs on shorter histories or thinner books; LTC, AAVE and ATOM clear neither. **Closed 2026-09-21 by §3.15**: POL fails window C on BOTH venues and BOTH parameter sets on a 0 % plateau (Kraken −20.6 % / −18.8 %), so it is not a one-window coin waiting for a rule — it is a coin that fails the third window it was given. No paper seat, and the asymmetry with AVAX is resolved by measurement rather than by a decision. §3.15 also answers this item's other named candidates from §3.12's side: ZEC, XMR and TRX each clear one window and none clears two.
17. **The pre-live review, and what was done about it (2026-09-21).** An independent review of every agents file — the loop, the venue clients, the strategy module, the migrations, the page — is `docs/agents/reviews/2026-09-21-prelive-review.md`: seven blockers, sixteen should-fixes, twelve missing tests, the doc gaps. Shipped with pins the same day (`tick.test.ts`, `revx.test.ts`, `index.test.ts`, `strategy.test.ts`): **B1** a `pending` row the venue does not list STAYS pending — a marketable order fills or dies inside the turn, so its absence from the active list proves nothing — reported every turn with the venue's balance beside what the record holds, until a person settles it from the venue's history; **B2** a cancel whose read-back fails leaves the row open for the next turn to settle from the venue; **B3** the fills query is paged (`selectAll`; PostgREST stops at 1,000 rows without a word — the tick and the dashboard both read the whole book); **B4** `orderViewProblem`: a filled Revolut X order whose reply lacks `filled_size`, `average_fill_price` or `fees` is an error, never a fill at fee 0, and the probe now reads `/1.0/orders/active` and Kraken `ClosedOrders` and reports the field names each venue returns — the first live order's read-back is the verification, and until then those three names are the client's assumption, not a fact of this reference; **B5** a re-quote goes through `riskGate` like any order (global pause included); **B6** an allowed decision whose order never reached the book is placed on a later turn, the bar's claim staying with the decision, and migration `0041` makes the order insert the claim on the attempt so two turns' retries are one order; **B7** the lease is released by its holder only, renewed once past half its length, and a turn past 70 % of it opens no new bar decision (stops and observations are never deferred); **S1** the snapshot and the bar rule read the high-water trailed to the market, so the state's `drawdown_from_high` and the ATR clause match the backtester (the per-minute stop always did); **S3** a symbol with no quote and no candle has no mark, not a mark of 0; **S4** a protective decision claims one second into its minute, never a bar start; **S5** an open buy's unfilled notional is exposure now; **S6** the model's exit-advice branch is gone — Jev can veto an entry and nothing else (the rows' `exitMax` parameter is inert); **S8** `lookbackDays` moves the momentum window; **S9** a cached series must be contiguous to count as warm; **S10** the execution venue's 1-minute candle is fetched only where a paper order rests (the public Revolut X calls a turn are tickers and pairs plus one per resting paper order — four with none resting, against the eight §4.2's "half a dozen" had grown to); **S12** the probe checks every symbol on an active row; **S16** today's P&L is summed strategy by strategy from each one's signal venue's day open, in the tick and on the page alike. **S2** — `runRotation` now takes the same `StopParams` `run` takes and the rotation rows' figures were re-run with the floor and the cooldown the loop applies to them (§3.4, rewritten; `latest.json` / `summary.json` regenerated; pinned by `backtest.test.ts`), and the answer was worth having: **the 8 % floor makes the rotation rule worse on five variants of six**, which no table said before because no table ran it. **Retention, decided rather than left open** (the review's last doc gap): `agent_decisions` and `agent_orders` are kept INDEFINITELY and pruned by nothing — they are the record the whole design rests on, ~175 rows a day between them, so a year is under 70k rows and the storage is not the question. What made an unbounded table dangerous was reading it unpaged, which B3 fixed; `0037`'s prune covers only the bulky, reproducible tables (30 days of basis and observations, 120 days of candles, 3 days of minutes). If a prune is ever wanted here, it archives rather than deletes: a fill that is gone is a position that never existed. **Not done, and said so**: **S7** is done in code (§4.18: one nonce sequence per isolate, pinned) with the venue-side half — a nonce window on the key — named as a prerequisite for the first live Kraken order; still open: **S11 / S13 / S14 / S15** on the page (a paused row holding a position, the dashboard refresh race, unmasked sizes, the missing live-unconfirmed alert) and the sweep fixture; §4.11's sentence stands corrected here rather than rewritten, so the record shows what was claimed and when it was found wrong.

18. **One nonce sequence per isolate, and a nonce window on the key before Kraken goes live.** Kraken's private calls need a nonce that only ever goes up for a key (§2b: repeated bad nonces get the key banned for a while). `loadKraken()` built a fresh generator per REQUEST, so a dashboard load (balances, fee tier) and a tick in the same isolate, in the same millisecond, minted the same nonce — reproduced in `kraken.test.ts`, two generators seeded from one clock returning one value. Every private call now draws from a module-level `krakenNonce`, so the sequence is strictly increasing whatever else is in flight. What code cannot fix is a COLD isolate starting inside the same millisecond as a warm one's last call: that is closed at the venue, by setting a **nonce window** on the key in Kraken's API settings (a few seconds is enough), and it is a prerequisite for the first live Kraken order alongside the GBP → USD conversion. Until then Kraken rows are paper, where a rejected private call costs a log line.

## 5. Questions that blocked the build — answered 2026-09-20

1. **The Ed25519 private key** is in the secrets store as `REVOLUT_X_PRIVATE_KEY`, pasted as the bare base64 of the 48-byte PKCS#8 DER (the probe reports `keyForm: pkcs8-b64`). `Revolut_X_API_kEY` is the 64-char id; both spellings are read.
2. **The sub-account.** Davies created the key under Revolut X's Sub-accounts feature, and the signed `GET /1.0/balances` shows exactly ONE row — USD, equal to the sub-account's funding — and nothing of the main account. The key sees the sub-account only; isolation holds at the venue, not just in our caps.
3. **Key permission** trading; **IP allowlist** left blank at creation (no allowlist), which is what Edge egress needs.
4. **Paper first** confirmed ("确认，paper 先行").
5. **Kraken** (added the same day): key pair `KRAKEN_PRO_API_KEY` / `KRAKEN_PRO_PRIVATE_KEY`, trading permission, unfunded. Verified by the probe below; the design consequence is §2b.

## 6. Live probes — what the real keys said (2026-09-20)

Two runs of `GET /functions/v1/agents?action=probe` (read-only; nothing can
place an order), fired from the database with the Vault `cron_secret`
through `net.http_get`, 03:49 and 04:08 UTC. Balances are not copied here.

| Check | Result |
|---|---|
| Revolut X key form | `pkcs8-b64` — bare base64 PKCS#8, imports straight into WebCrypto Ed25519 |
| Revolut X `/balances` (signed, no query) | 200; one USD row (the sub-account's funding), no other currency |
| Revolut X `/configuration/pairs` | 200; 394 pairs; BTC/ETH `base_step` 1e-8 / `quote_step` 0.01, SOL 1e-6 / 0.001; `min_order_size_quote` $0.1 |
| Revolut X `/candles/BTC-USD?interval=240&since=&until=` (signed WITH a query) | 200, 5 candles → the "query without ?" signing is right |
| Kraken secret | decodes to 64 bytes, as issued |
| Kraken `Balance` / `BalanceEx` | 200; rows `USDC 0`, `ZGBP 0` — the account is empty and its currencies are USDC and GBP |
| Kraken `TradeVolume` | 200; `fees.fee` 0.8000 and `fees_maker.fee` 0.4000 on XXBTZUSD / XETHZUSD / SOLUSD; `nextvolume` 2,500 → 0.6 / 0.3 |
| Kraken `OpenOrders` | 200; 0 open — "Query open orders" permission works |
| Kraken `AddOrder` with `validate=true` (buy 0.0001 XBT @ $10,000, post-only, GTC, UUID `cl_ord_id`) | 200; `descr.order = "buy 0.00010 XBTUSD @ limit 10000.0"`, **no `txid`** — trading permission works, nothing placed |
| Kraken `OHLC` 240 | 721 rows, first 2026-05-23 — the 720 ceiling, live |
| Kraken spreads at the probe | BTC 0.01 bps, ETH 0.04, SOL 0.92 |
| Jev via OpenRouter | model resolves to `typesafe/jev-1.13-20260917`, provider "TypeSafe"; 437 input / 66 output tokens; `usage.cost` 0.000018354 = 437 × $0.042/M exactly; 464–476 ms |
| Jev direct | `jev-1.13.0`; same 437 tokens, no `cost` field; 687–690 ms |
| Answer shapes (both) | `noul` → `{ type, noul: 0.98 }`; `choice` → `{ type, choice, probabilities, confidence }`; `score` over `["calm","elevated","extreme"]` → `{ type, score: 0.07–0.08, legend: {0:calm,1:elevated,2:extreme}, probabilities: {0:0.93,1:0.07,2:0}, confidence: 0.89 }` — **the score is the expected level index on a 0…(levels−1) scale**, so `cautionExit: 1.75` in `combineDecision` means "mostly extreme". Confidence matches `(count×peak−1)/(count−1)` to rounding. The two transports agree within 0.01–0.02. |

## Sources

- TypeSafe: https://docs.typesafe.ai/models · https://docs.typesafe.ai/api · https://docs.typesafe.ai/confidence · https://docs.typesafe.ai/concepts/state · https://docs.typesafe.ai/model-jaggedness/jev-1.13 · https://typesafe.ai/blog/introducing-system-one-models-and-jev · https://docs.typesafe.ai/llms.txt
- OpenRouter: https://openrouter.ai/typesafe/jev-1.13 · https://openrouter.ai/labs/jev · https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints · https://openrouter.ai/docs/client-sdks/go/sdks/decisions/README
- Integrations: https://github.com/prismhq/jev-router · https://github.com/typesafe-ai/typesafe-sdk-js · https://pydantic.dev/docs/ai/models/typesafe/ · https://docs.litellm.ai/docs/pass_through/typesafe · https://github.com/samchon/typia/issues/2409 · https://github.com/can1357/oh-my-pi/issues/12458 · https://github.com/vinaychawla-ops/jev-openrouter-example
- Revolut X: https://developer.revolut.com/docs/x-api/revolut-x-crypto-exchange-rest-api · https://developer.revolut.com/docs/x-api/authentication · https://developer.revolut.com/docs/x-api/place-order · https://developer.revolut.com/docs/x-api/get-candles · https://developer.revolut.com/docs/x-api/get-all-balances · https://github.com/revolut-engineering/revolut-x-api (incl. `revolut-x-api-for-llm.md`) · https://www.revolut.com/legal/crypto-exchange-fees/ · https://help.revolut.com/en-FR/help/wealth/cryptocurrencies/crypto-exchange/api-trading/question-what-api-does-revolut-x-provide/
- Kraken: https://docs.kraken.com/api/docs/guides/spot-rest-intro/ · https://docs.kraken.com/api/docs/guides/spot-rest-auth/ · https://docs.kraken.com/api/docs/rest-api/add-order/ · https://docs.kraken.com/api/docs/rest-api/get-orders-info/ · https://docs.kraken.com/api/docs/rest-api/get-trade-volume/ · https://docs.kraken.com/api/docs/rest-api/get-extended-balance/ · https://docs.kraken.com/api/docs/rest-api/get-ohlc-data/ · https://docs.kraken.com/api/docs/rest-api/get-recent-trades/ · https://docs.kraken.com/api/docs/guides/spot-ratelimits/ · https://docs.kraken.com/api/docs/guides/spot-rest-ratelimits/ · https://www.kraken.com/features/fee-schedule · https://support.kraken.com/hc/en-us/articles/360000919966-How-to-create-an-API-key · https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data
