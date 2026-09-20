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
| Rate limits | REST call counter 15 (Starter) / 20 (Intermediate, Pro), decaying 0.33 / 0.5 / 1 per second; ledger and trade-history calls cost 2, AddOrder and CancelOrder are on a separate limiter (`EAPI:Rate limit exceeded`). Matching-engine counter per pair 60 / 125 / 180, decaying 1 / 2.34 / 3.75 per second; AddOrder +1, a cancel costs up to +8 when the order is younger than 5 s and +1 under 300 s (`EOrder:Rate limit exceeded`). Max open orders per pair 60 / 80 / 225. **No daily order cap.** A 5-minute loop with a few orders a day never approaches any of this. | spot-ratelimits, spot-rest-ratelimits |
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
  2026-09-20 (≈ $100). The strategies trade `*/USD`, so the pounds need one
  conversion — GBP/USD on Kraken is 0.5 bps wide and $3.4M deep a day, on the
  0.20 % FX fee schedule (≈ $0.20 on $100). That conversion is the account's
  first real order and waits for his say-so, in the app or by the API. The
  `*/GBP` pairs exist (BTC/GBP 0.02 bps, ETH/GBP 1.3, SOL/GBP 3.7) but are
  thin and would put a second quote currency into a book that is USD
  everywhere.

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
lead Kraken has over Revolut X is seconds, invisible to a 5-minute loop
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

### 3.4 The rotation rulebook and the 1-hour trend variant (walk-forward, both venues)

`rotation-1d`: rank BTC, ETH, SOL and XRP by 30-day return at each daily
close, hold the top two equal-weighted, and only those above their
100-day average (dual momentum). Same data and split as §3.3 (XRP from
Coinbase, 2023-09 →); fills at the next day's open at the venue's
half-spread and maker fee. Out of sample is the bear year.

| Variant | Revolut X OOS | Kraken OOS | Exposure | Turnover | Revolut X full | Kraken full |
|---|---|---|---|---|---|---|
| default (top 2, filter on) | −12.2 % (DD 30 %) | −20.9 % | 33 % | 22×/y | +128 % | +56 % |
| filter OFF (always in) | −45.5 % (DD 62 %) | −53.0 % | 100 % | 23×/y | +142 % | +56 % |
| 7-day minimum hold | −15.8 % | **−16.1 %** | 39 % | 13×/y | +72 % | +41 % |
| top 1 | −33.8 % | −45.8 % | 30 % | 37×/y | +39 % | −34 % |
| top 3 | −4.4 % | −6.9 % | 33 % | 16×/y | +110 % | +55 % |
| 60-day lookback | −15.6 % | −22.4 % | 33 % | 17×/y | +75 % | +31 % |
| equal-weight buy & hold | −46.7 % | | 100 % | | +225 % | |

Reading: the bear filter is what protects capital — it gives up 14
points of the three-year return and saves 33 in the bear year. "Capital
active most of the time" is therefore a bull-market property of this rule,
not a setting: with the filter off it is always invested and follows the
market down. The filter is a parameter (`bearFilter`) Davies can switch
off, with these numbers in front of him. Kraken's fee costs 4–12 points a
year at 22 round trips; the 7-day hold halves the turnover and is the
Kraken seed. Top 3 did best out of sample, top 2 over the full period —
one bear year cannot separate them, so the seed keeps top 2.

`trend-1h` (the 4-hour trend rule on 1-hour candles, volatility annualised
for 24 bars a day): OOS on Revolut X costs BTC −10.1 % / ETH +9.6 % / SOL
+17.9 % over 58–74 trades, against the 4-hour rule's −9.6 / −7.0 / +18.5 %
with the same default parameters. It kept up, at three times the trade
count; on Kraken's fee it would not. It is seeded paper-only on Revolut X
because it produces decisions and fills fast enough to judge the loop and
the model within days, which the daily rules cannot.

## 4. Design consequences (decided by the evidence above)

1. **Jev is a decision node, not a strategist.** Code computes indicators, regime, position and risk; Jev sees ≤ 1–2 k tokens of categorical state and answers typed questions; a deterministic risk layer has the last word. Anything else contradicts the vendor's own jaggedness page.
2. **Cadence is minutes-to-hours, not seconds.** Signals on closed 1h/4h bars; the loop wakes every 5 minutes (the existing `snapshot-record` cadence) to manage resting orders and stops; a trade decision at most a few times a day. "Every second" would cost nothing on Jev and everything on fees and the 1,000-order cap.
3. **Limit orders by default, `post_only`**, taker only for stop-loss exits where certainty of fill matters more than 9 bps.
4. **BTC, ETH, SOL only** — the only pairs on this venue with ≤ 3 bps spreads and real volume. Everything else costs 3–8× more per round trip.
5. **Paper first.** Every strategy runs in shadow mode against live prices, recording the orders it *would* have placed, until its paper record is shown; the switch to live is a per-strategy flag Davies flips, and the first live order requires his explicit confirmation.
6. **Hard, code-enforced caps** the model cannot touch: max notional per order, max open exposure, daily loss limit (kill switch), max orders per day well under 1,000, and a global pause flag in the database.
7. **Record inputs, not conclusions** (the `snapshot-record` lesson): every Jev call's state, questions and answers, and every order's request/response, are stored; P&L is computed in one place from fills and marks.
8. **Two venues, each for what it is good at** (§2b, §2c). Revolut X executes (0 % maker); Kraken supplies the signal (`signal_venue`: its candles are the cleaner series) and runs paper twins whose fills pay its real fee. There is no arbitrage between them at any cadence available here — measured, not assumed — and the basis keeps being recorded so that stays true or is seen to change. Caps in `agent_risk` are per venue account and per mode.
9. **Capital utilisation is a consequence of regime, not a target.** The rotation rule holds the strongest two of four whenever they trend; in a broad bear it holds cash, because the alternative lost 45 % out of sample (§3.4). The switch that makes it always-invested exists and is Davies' to flip, with the number beside it.
10. **Nothing fast.** A 5-minute loop, a 1,000-order day on Revolut X and 40–80 bps a side on Kraken rule out market-making and cross-venue trading; the fastest rule that survived costs is the 1-hour trend variant, paper-only, kept for feedback speed rather than for return.

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
