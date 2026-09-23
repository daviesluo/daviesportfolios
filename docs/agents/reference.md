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
| Order types | `market`, `limit` (with `post_only` / `allow_taker`), `conditional`, `tpsl`. **Time in force at placement: `gtc` or `ioc` only, `gtc` when omitted, and `post_only` never with `ioc`** — the venue's own TypeScript client (`PlaceTimeInForce = "gtc" \| "ioc"`, sent as `order_configuration.limit.time_in_force`, refused otherwise by its schema) and its CLI (`--time-in-force gtc\|ioc`; `--post-only … cannot combine with ioc`). The same repository's LLM reference says the field "cannot be set during order placement"; the client and CLI that place orders are taken over that line. `fok` appears only on an order read back. | revolut-engineering/revolut-x-api `api/src/types/orders.ts`, `api/src/validation/schemas.ts`, `cli/README.md` (read 2026-09-22) |
| Place order | `POST /1.0/orders` `{ client_order_id (uuid), symbol "BTC-USD", side, order_configuration: { limit: { base_size \| quote_size, price, execution_instructions, time_in_force } \| market: { base_size \| quote_size } } }` → `{ data: { venue_order_id, client_order_id, state } }` — an OBJECT in the schema and the LLM reference's example; an array in one older sample. The client reads both. The documented example's `state` is `new`, so a placement reply does not say whether a marketable order filled: the read-back does. | docs/x-api/place-order; `revolut-x-api-for-llm.md` |
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

Daily candles paginate back to **2023-08-19 (BTC), 2023-09-05 (ETH), 2023-09-11 (SOL)** — three years, at ~1,000 candles per call. One-minute candles exist.

**Corrected 2026-09-22, measured rather than inferred.** This paragraph
used to say hourly was "available for the same span", and §3.16 then said
the tape needed a signed call and was unreachable from a harness. **Both
were wrong.** The endpoint is public — `GET /1.0/public/candles/{SYM}?interval=240&region=UK`,
1,000 candles a call, paged with `until=<ms>`, the same one-token-a-second
public bucket — and `region=UK` is §4.14's requirement, since without it
it serves the EEA book this account cannot trade. Pulled keylessly for all
27 coins: **2,257 four-hour bars each, 2025-09-11 → 2026-09-22 — 376 days,
1.03 years**, no gaps except TON (2) and ETC (1). `backtest.ts`'s own
header, which said one year of intraday, was the correct statement all
along.

**What that one year means, and it is the reason the question mattered**:
Revolut X's tape covers walk-forward window A (out of sample 2025-09-10 →
2026-09-20) with one day to spare at the start, and **covers nothing of
windows B, C or D**. So the venue's own book can price the bear year — the
window that decides the ranking — and no other. It also settles §3.16's
T4 with a measurement instead of an argument: moving `signal_venue` to
`revx` would not merely shorten the evidence, it would delete three of the
four windows.

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

Buy-and-hold over the window: BTC +26 %, ETH +2 %, SOL −25 %. Selected rows (full table in `docs/agents/scripts/agents-baseline-backtest.py`):

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
  `probeFollowUpDue`, and three end-to-end cases). **Read on the dashboard
  since 2026-09-22** (`probeSummary`, pinned in `index.test.ts`): the fill
  rate over resolved probes, the median minutes to fill, and `adverseBps`
  at +15 and +60 minutes — **signed so that POSITIVE is against the fill**
  (a buy that filled and then fell, a sell that filled and then rose).
  That median against the 10–20 bps band above is the whole answer: over
  it, resting loses more to selection than the 9 bps taker fee costs;
  under it, the fee is the bigger number and resting is worth testing with
  real orders. It was briefly rendered under VENUES and **taken off the page the
  same day on Davies' word** — the probe keeps collecting and
  `probeSummary` stays in the dashboard payload, so the numbers are there
  to read with a query when they are wanted, but the page does not carry
  them. What it measures has not changed; only who looks at it, and when.
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

**What it could not settle.** **The fill price was unmodelled and is not any more — §3.18 closed
it the same day, on the venue's own book: the split is worth −0.05 points
against this section's Kraken arm, and 0.057 bps of adverse cost a round
trip, 0.29 % of the cheapest round trip.** What that study also found is
that this section's Kraken arm is the RIGHT proxy for the three windows
with no Revolut X tape, and a Coinbase-fill proxy is not (error +0.05
against −4.93 points). The original wording follows, because the finding
is that it was a real gap: the
loop decides on Kraken and fills on Revolut X, and no table in this
repository simulated that split — §2c's ≤ 3 bps basis suggests it is
small against 9 bps of taker fee, but suggests is not measures, and this
is the obvious next study. **Both of this paragraph's claims about Revolut X's own
tape were wrong and are corrected in §2.3 (2026-09-22)**: the tape needs
no signed call — `/1.0/public/candles/{SYM}?interval=240&region=UK` is
public and paged — and the contradiction it flagged is settled by pulling
it. `backtest.ts`'s header was right: **2,257 four-hour bars per coin,
2025-09-11 → 2026-09-22, 1.03 years**, which covers window A and none of
B, C or D. That makes this section's T4 recommendation stronger, not
weaker: moving `signal_venue` to `revx` would delete three of the four
windows, measured rather than argued. It also means the fill study named
above can be built on the REAL venue book for the bear year. HBAR drops out
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

### 3.18 Deciding here and filling there — the split nobody had modelled (2026-09-22)

Every `agent_strategies` row decides on Kraken's candles and fills on
Revolut X (`signal_venue`), and until this study **no table in this
repository priced that split**: each one used a single series for both.
§2c's ≤ 3 bps basis said the error was probably small; probably is not
measured. Run by an independent agent as
`supabase/functions/agents/backtest_fill.ts`. Output
`docs/agents/backtests/fill.json`, report
`docs/agents/reviews/2026-09-22-fill-study.md`. Re-run here:
**byte-identical**.

**It was built on the REAL venue book, not a proxy.** Revolut X's UK
4-hour candles are public (§2.3, corrected the same day), so window A —
the bear year, the window that decides the ranking — could be priced on
the book the orders would actually meet. B, C and D have no such tape and
never will from this source.

**The fidelity check found a bug, and it is the most instructive thing
here.** The first split trailed the position's high-water on the FILL
tape. `tick.ts` trails it on the SIGNAL tape (`trailed(pos, bars,
forming)`, `highWaterSince(pos, bars, i)`, `atrAt(bars, i, …)` — `bars`
is `signalFor(s, sym).bars`, verified here). **High-water is an input to
a decision, not a price paid.** The wrong split manufactured a
**19-point difference on AVAX window A** (+31.75 % against the correct
+12.49 %) out of two tapes that agree to 4 bps. A plausible-looking
"signal decides, fill does the rest" split would have produced a large,
clean, fictitious result. Corrected, all three arms fill at the same
timestamps. `runSplit` against `run` with fill = signal: **2,600 cells at
zero difference** in return, drawdown, trades, days, exposure and fees,
and **903,928 equity-curve points** compared one for one, also zero — run
twice per cell, once with a cloned array so the split path is exercised
rather than short-circuited. Arms (a) and (b) reproduce `tape.json` on
**2,520 cells per stop rule, zero differ**, against its recorded SHA-256.

**F2 — the three arms** (window A, shipped stops, seeded, five $20
slots). The two extra rows are the proxies, and they are the point:

| arm | signal | fill | return | DD | ret/DD |
|---|---|---|---|---|---|
| (b) every published table | Coinbase | Coinbase | +7.62 % | 11.32 % | 0.67 |
| (a) §3.16's Kraken arm | Kraken | Kraken | +8.74 % | 10.96 % | 0.80 |
| **(c) what the loop does** | **Kraken** | **Revolut X UK** | **+8.69 %** | **11.20 %** | **0.78** |
| (p) proxy: fill on Coinbase | Kraken | Coinbase | +3.76 % | 11.13 % | 0.34 |
| (q) control | Coinbase | Revolut X UK | +11.95 % | 11.40 % | 1.05 |

**(c) − (b) = +1.07 points. (c) − (a) = −0.05 points.** The thing that
was never modelled is worth five hundredths of a point; the thing §3.16
already measured is worth twenty times more. Per coin, (c) tracks (a)
within 0.8 points on all five.

**And the proxy calibration changes which proxy to use.** Measured
against truth on window A: filling on **Kraken** errs by **+0.05 points**
at sleeve level; filling on **Coinbase** errs by **−4.93**, with a
per-coin maximum of 28 points and a leave-one-out order that disagrees.
So B, C and D must be read off arm (a) — which is what §3.16 already
published — and never off a Coinbase-fill proxy.

**Why, in one coin.** Revolut X is CLOSER to Coinbase than to Kraken on
closes (3.13 against 4.94 bps median). But closes are not what decides a
stop — **lows are**, and lows are where venues disagree most. SUI, verified
here against all three tapes: the position is entered around 0.8757, so
the 8 % floor sits at 0.8056, and on the 4-hour bar of **2026-09-20
00:00** Kraken's low is 0.8124 and Revolut X's is 0.8100 — both above it —
while **Coinbase's is 0.8051**, five ten-thousandths through. **Six basis
points of wick.** The Coinbase-fill arms stop out there and book +1.4 %;
the arms that fill on Kraken or Revolut X hold to above 1.01 and book
+29–30 %. **A stop fires on the one price the venues agree on least**,
which is the structural reason a foreign tape cannot stand in for the
fill.

**F3 — the cost, in bps.** 296 real fills, 23 coins, 376 days: |basis|
median **4.53**, p95 27.5, max 69.2 bps. Signed against the trade, the
median is **−0.06** and the mean **+0.03**; 141 adverse against 149
favourable, **p = 0.68 — no direction**. **The mean adverse cost is 0.057
bps a round trip**, against a round trip that costs 19.5–41.9: **0.29 % of
the cheapest one, and 0.32 % of the 18 bps of taker fee inside it.** §2c
had the right order of magnitude. The 2×2 decomposition (signal −3.56,
fill +4.63, interaction +0.60, summing to +1.07 exactly, with the
identity printed) is in the JSON, and the report says not to lean on it:
two main effects of about four points that nearly cancel, both dominated
by the contaminated Coinbase-fill cells.

**One signed finding, and it does not survive its own correction.**
Protective stops are **+5.28 bps adverse on 17 of 23 coins, p = 0.035** —
the adverse-selection signature, since a stop fires *because* the
execution venue's low reached the level. Šidák over the three tests takes
it to 0.10, n is 23, and the executed price is `min(level, open)`, so it
measures venue disagreement at stop instants rather than per-order
slippage. Written down as a watch, not a result. Entries are
**favourable** by 1.24 bps (p = 0.118) and rule exits neutral.

**F4 — what changes: nothing that matters.** §4.15's bar flips on **1 of
23 coin-windows** (ICP, on plateau, in no row); **none of the five live
coins moves.** Leave-one-out on arm (c) is arm (a)'s ordering, coin for
coin and sign for sign, differing from the published arm only in the way
§3.16 already recorded. §3.11's ranking holds: `trend-4h` alone first on
the loop's own arm (0.78) ahead of both venues (0.49) and +momentum
(−0.04). The equal-slots test **cannot** be re-run on arm (c) — §3.11
requires beating equal slots on BOTH windows and arm (c) has one — and
the report says so rather than quoting the one-window result, in which
inverse-volatility and concentration do beat it. That refusal is §4.15
working.

**What it could not settle.** Three of four windows have no real fill
tape and never will from this source, which serves a rolling 376 days —
so the study's INPUT is not reproducible forever even though its output
is byte-identical given the same directory (per-coin spans are in the
provenance; the puller is in §2.3). **Bars are not fills**: this prices at
a 4-hour bar's open on the execution venue's tape, not at the touch
inside a minute — the gap between those is exactly what `0042`'s maker
probes are recording live. Only `trend-4h` was re-priced. 23 stops is the
entire sample behind the one directional finding. The one-day shortfall
against window A was handled by a clip declared before any return was
read (374.2 of 375 days, applied to every arm), and its cost is measured:
BTC 0.00, ETH 0.00, **SOL −2.41 points** — which is why the published
sleeve reads +7.62 % here against §3.16's +8.0 %.

### 3.19 The four settled choices, re-asked on four windows and three tapes — nothing changes (2026-09-22)

Three of the live row's defining choices — which coins, equal slots, the
mechanics — were settled on TWO windows and ONE price series, and §3.16
then showed that a per-coin verdict moves up to thirty points when the
series changes. So they were re-asked with everything now available: four
windows, both existing tapes, and for window A a THIRD — Revolut X's own
UK book (§2.3). Run by an independent agent as
`supabase/functions/agents/backtest_set2.ts`. Output
`docs/agents/backtests/set2.json`, report
`docs/agents/reviews/2026-09-22-set-study.md`. Re-run here:
**byte-identical**.

**The bar for a change, set before the search**: an arm must beat the
incumbent on the WORST of its four windows in ALL FOUR evaluations
(2 tapes × 2 stop rules). Two exact nulls are reported, independent arms
and fully-correlated arms, and the agreement between the four evaluations
is **measured** (0.63–0.83) to say which null to read. It is the
correlated one.

| search | arms | passed | independent null | correlated null |
|---|---|---|---|---|
| A1 coins | 25 | 3 | 1.56 | 12.5 |
| A2 weights | 6 | 2 | 0.38 | 3.0 |
| A3 cooldown | 8 | **0** | 0.50 | 4.0 |
| A3 sizing | 11 | 1 | 0.69 | 5.5 |
| A3 stop surface | 23 | 8 | 1.44 | 11.5 |
| A4 venue | 25 | 1 | 1.56 | 12.5 |
| **whole study** | **98** | **15** | 6.13 | **49** |

**A1 — the coins: no change.** Five leave-one-out and twenty add-one-in.
Three arms pass (drop AVAX, add ICP, add ATOM) against 1.56–12.5 by
chance, and **not one add candidate is admitted by §4.15's bar**: ATOM's
UK book is $17k a day, a sixth of the floor, and it clears no window; ICP
clears the book test and windows A and D but fails B in every condition.

**A2 — equal slots stands, and the new arm is the interesting one.**
Inverse volatility and per-entry volatility scaling do beat equal slots on
the worst-of-four — and **0 of 6 arms beat it in the bear year on any of
the three tapes**, both looking worst on the venue's own book (−0.60 and
−0.21). The arm §3.15 predicted would fail was priced rather than
assumed: **weighting a coin by how many windows it clears fails 0 of 4
honestly and 0 of 4 WITH look-ahead**, while a return-based look-ahead
bound is worth +1.68…+2.59 — so the lever works and the evidence for
aiming it does not exist.

**A3 — the ranking moves, the settings do not.** Adding window D
re-orders all three searches nearly end to end: the four-window against
two-window rank correlation is +0.40/−0.75 for the cooldown,
+0.39/−0.52/−0.08/−0.22 for sizing and −0.10/−0.54/**−0.81**/−0.78 for the
stop surface. And of 42 arms, 9 beat the shipped setting on the worst
window and **0 beat it on every window**: every winner buys the sideways
year by giving back the bear or the bull. The cooldown grid spans 0.04 of
return-over-drawdown in D and is **identical** in A and B; all eight
stop-surface winners are one time-stop idea, and the best of them
(`floor 8 % + time stop 20 bars`) takes D from −0.50 to −0.32 and A and B
from 0.71 to 0.40. This is §3.17's finding again from another direction:
the sideways year is not a bug to be filtered out.

**A4 — the venue: settled, and the question should stop being asked.**
3 of 372 cells favour Kraken (a sign test at p = 1.8 × 10⁻¹⁰⁵ the other
way); exactly one coin (SUI) beats on its worst window in one of four
conditions, under the `trail` stop the loop retired on 2026-09-21; **0 of
50 cells on the venue's own book**. The reason is arithmetic rather than
a backtest, verified here from `COSTS`: **the WORST Revolut X round trip
is TON at 53.8 bps and the BEST Kraken round trip is BTC at 80.0 —
the two cost schedules do not overlap, by 26.2 bps.** Trading on Kraken
at its best costs more than trading on Revolut X at its worst. That
answer moves when a fee tier moves and not before.

**The third tape, and one finding that does not generalise.** 26 of 27
coins priced over window A (HYPE has no scored window A on any tape);
coverage floor 95 % declared first, achieved min 99.73 %. §3.16 found the
tape disagreement had **no direction** — that does not extend to the
venue's own book: at one observation per coin (the study's own guard
against the pseudo-replication §3.16 caught itself in), **Revolut X reads
LOWER than Kraken on 21 of 25 coins, p = 0.00091**, and lower than
Coinbase on 17 of 25 at p = 0.108. Recomputed here from the raw counts,
both reproduce exactly. So a per-coin Kraken figure is mildly optimistic
about the book the orders meet. **It does not carry to the live five**
(mean +1.6 points against Coinbase, −2.5 against Kraken; SUI +25.5, AVAX
−15.1), and the live sleeve in the bear year on the venue's own book is
**+10.39 %, drawdown 10.57 %, ret/DD 0.98** — better than either published
tape (0.71 and 0.84).

**Fidelity.** Three `runSet` paths (null branch, weights ≡ 1, one-tranche
plan) against `run`: **844 cells each, zero difference**. Against
`tape.json` cell for cell: **3,456 cells, zero differ** — so this harness
IS §3.16 and every difference reported is the choice being tested.
Against §3.17's published row table, typed in from the document:
**worst |Δ| = 0**. Window D across tapes, identical by construction:
zero over 84 cells per stop rule. 22,788 grid points evaluated.

**What it could not settle.** The third tape is one year and one window,
so the "reads lower than Kraken" finding is a single-window observation
and no parameter can be chosen on it. **This study never splits signal
from fill** — every arm prices both on one series, including the
third-tape arm; §3.18 owns that split and the two were run in parallel.
Window D binds every A1 and A3 verdict and is a single draw of 21 coins
nested inside C's in-sample. SUI has two windows, so C and D are
four-coin sleeves and SUI is absent from the window that decides A1.
`trend-1h` is priced on neither new tape (Kraken's hourly bundle ends
2026-06-30; the venue's tape is 4-hourly). The ROWS were not re-asked —
§3.17 owns that. `agent_risk`'s daily loss limit is not simulated.

### 3.20 SUI's seat in the live row, judged on what SUI has — keep it; the evidence cannot decide (2026-09-22)

Davies' question: "SUI only passed window A — is it still worth including?"
The four-window rule is blind to SUI by construction: SUI has windows A and B
only, so removing it moves the worst of four windows by exactly 0.00. The
study (`supabase/functions/agents/backtest_sui.ts` → `docs/agents/backtests/sui.json`,
report `docs/agents/reviews/2026-09-22-sui-study.md`) therefore judged all five
members the same way on what SUI does have: windows A and B, the 3.34 years
all five share, seven six-month folds, drawdown damping, SUI's own book, and
its entry states. Both tapes, both stop rules, never averaged. It imports
`run` and never copies it (the daily wrapper matches `run` on 358 cells; 170
of 170 cells match `set2.json`, 1,728 of 1,728 match `tape.json`). Two runs
in parallel wrote byte-identical output, sha256 `badf7b33…`.

**One pre-registered test** decides a drop: SUI's rank among the five on the
cost of removing it, fold by fold, with an exact rank-sum null; drop only if
p(worse) < 0.05 on BOTH tapes. Result: mean rank **3.57** (Coinbase tape) and
**3.43** (Kraken's) where chance gives 3.00; p(worse) **0.178** and **0.256**.
**Undecided, so no change: SUI stays in the live row as the incumbent.**
Deciding it at the effect size seen would take about 50 folds, some 24 years.

The two sides, both inside chance:

| | against the seat | for the seat |
|---|---|---|
| earnings | its slot made −5.8 % / −1.1 % over 3.34 years, last of five on both tapes; dropping it raises return in 6 of 7 folds (sign test p = 0.125; t-test p = 0.049 / 0.051, which is 2 hits in 30 secondary tests where chance gives 1.5) | — |
| risk | — | correlation with the other four 0.03–0.22 against 0.35–0.57 for BTC / ETH / SOL; the only member whose $20 lowers the bear year's dollar drawdown under the running stop; the only member whose removal makes the worst fold worse (−0.85 → −1.00, −0.82 → −1.00) |

**In paper it stays too, for a different reason.** Under the running stop
SUI would not be admitted today: it clears §4.15's bar on window A only, and
fails three of four tests on window B (−2.53 % / −2.72 %, plateau 44–48 %,
−4.26 % / −4.44 % on Kraken's costs). One window of two is what chance gives
about 40 % of coins. §3.8's admission reproduces only under the old
intra-bar trail (A +14.51 %, B +3.01 %) and fails even there once window A is
cut where every coin's file ends (−9.05 %): most of what SUI earned in window
A sits in the last 36 hours of data. The paper row measures what no backtest
can: SUI's real book and the model's replies at its entries.

**Two corrections to earlier sections.** SUI's round trip is not ~42 bps:
sampled 60 times, its UK book's median spread is **14.9 bps** (p90 23.8, max
38.6; 20 bps or wider in 35 % of samples, where no other coin reached 20
once), so the median round trip with the taker fee both ways is **~33 bps**;
the 23.94 bps spread §3.8 assumed sits at SUI's p90. And the prior audit's
"SUI lowers return in both windows" holds on the Coinbase tape only: on
Kraken's tape SUI raises window A (+9.16 % with it, +3.56 % without), and on
Revolut X's own book (+10.39 % vs +5.50 %).

**Decided 2026-09-23: SUI stays on paper and does not go live.** Davies
left the seat to the session ("你做决定吧删了也行"). The pre-registered test
above cannot decide, so the call rests on the admission rule: real money
goes only to the core majors and to coins that clear §4.15's bar under the
stop that runs. At Revolut X's cost, under the shipped stop with the seeded
parameters and both tapes agreeing, AVAX clears both windows and SUI clears
window A only (`binance.json` Part 3's headline; one two-window coin of 23
is what chance gives, so this is the bar admitting AVAX, not proof of an
edge — §4.15's "the bar admits a coin; it does not certify"). SUI's UK book
is also the thinnest of the five (median 14.9 bps, 20 bps or wider 35 % of
the time). The go-live draft (`0049`) adds BTC/ETH/SOL/AVAX at four $25
slots on the same $100 — possible because the fixed $20 per-order cap went
the same day (§4.26). The paper `trend-4h` keeps all five, so SUI's record
continues and the live row's control still shares every bar on the four.
What it costs and earns, from `sui.json` (primary evaluation, the $100
spread over the four): window B +20.1 → +25.1 %, window A +8.0 → +8.5 %
with its drawdown 11.3 → 15.8 % (Kraken's tape: A +9.2 → +3.6 %, drawdown
10.9 → 15.0 %); C and D do not change. Over the one span where all five
coins exist (S2, 2023-05-20 → 2026-09-20, a single path that overlaps A and
B), four $25 slots made +81.8 % against five $20 slots' +64.2 %, drawdown
11.1 % against 10.8 % (Kraken's tape +80.0 % against +63.8 %, 10.6 % both).
The bear year's drawdown is the price of the thinner book staying out of
the live account.

### 3.21 Volatility-sized slots and DVOL and funding entry gates — all three fail (2026-09-23)

The Binance and Deribit research (§6, "Binance and Deribit keys") ranked
three uses of their data for the live row: size each slot by the coin's
volatility, skip entries when implied volatility (Deribit's DVOL) is high,
and skip entries when perpetual funding is high. Each was pre-registered
before it ran (`reviews/2026-09-23-sizing-filters-prereg.md`) and judged by
the set study's bar: beat the incumbent's worst window in all four
evaluations, and beat a null of the same size there. Script
`agents/backtest_sizing.ts` → `backtests/sizing.json` (sha256
`197b3585…`, identical in the study's two runs and the main session's
re-run); review `reviews/2026-09-23-sizing-filters-study.md`; inputs in
`backtests/inputs/`. The incumbent reproduces exactly (A +8.03 / B +20.08 /
C +55.64 / D −7.81 %).

| hypothesis | worst window (D), primary: incumbent → arm | beats the null there? |
|---|---|---|
| H1: entry size × min(1, 0.7405 / 30-day realised vol) | −7.8 → −6.5 % | no: the coin's own volatility 365–730 days earlier does as well in 34–60 % of draws |
| H2: no entry while DVOL is in its top third of 365 days | −7.8 → −7.8 % (no D entry refused) | no |
| H3: no entry while 7-day funding is in its top fifth of 365 days (B, C, D only) | −7.8 → −1.8 % | no: random refusal of as many entries matches it in 5.6–34 % of draws |

**None is adopted**; the lowest deciding p is 0.056 against a family level
of 0.0167. H1 is a small dial (+1.2 points in D, −1.1 to −5.4 in B and C);
H3 wins the sideways year by holding less and pays 9.8–19.5 points of the
strong bull year, §3.17's finding again. H2 beat its null in window A in all
four evaluations (p 0.030–0.042), which is one window. This is the fourth
pricing of volatility scaling (§3.10, §3.11, §3.19); H2 and H3 join §3.17's
33 entry gates, none of which cleared the bar.

### 3.22 The live row at Binance's cost — no verdict changes (2026-09-23)

Davies holds a Binance spot account (0.10 % maker and taker at his tier, 0.075 %
with BNB; §6). The question, pre-registered before any Binance arm ran
(`reviews/2026-09-23-binance-cost-prereg.md`, with an addendum for one
descriptive arm): what the live coins, SUI's seat and §4.15's screen become if
the same orders were executed at Binance's cost — the same rule, windows, tapes,
stops and evaluations, only the cost changed (10 or 7.5 bps a side plus half of
Binance's measured spread). Script `agents/backtest_binance.ts` →
`backtests/binance.json` (sha256 `b7e4fb4f…`, identical in two runs and in the
main session's re-run; the Revolut X arm re-derives `tape.json`, `set2.json` and
`sui.json` with 0 differences); review `reviews/2026-09-23-binance-cost-study.md`;
book samples in `backtests/inputs/binance_books_2026-09-23/`.

- **The live sleeve**: round trips BTC 19.5 → 20.0, AVAX 27.6 → 20.9, SUI
  41.9 → 21.0 bps; the worst window stays D under every arm (ret ÷ DD −0.50 at
  Revolut X, −0.50 at Binance, −0.48 with BNB). Window A on the Coinbase tape
  gains 5.6 points, and 5.56 of them are one SUI stop: the 8 % floor was
  reached by 8.4 bps at Revolut X's spread and missed by 3.0 bps at Binance's,
  just before SUI's file ends on a rally the other coins' files do not contain.
  On Kraken's tape the same window moves +0.29.
- **SUI's seat**: §3.20's test stays undecided under every arm (p(worse)
  0.194 / 0.256 at Binance). SUI is still last of the five on both tapes; its
  slot earns −0.4 % / +2.2 % at Binance against −5.8 % / −1.1 % at Revolut X,
  so its wide UK spread is not what makes its record weak.
- **The screen** (23 coins, shipped stop, both tapes agreeing): one coin clears
  both windows at Binance's cost (AVAX), where chance gives 4.17; no coin is new,
  and the pre-registered reading rule finds something in 0 of 48 cells. Every
  difference from Revolut X is its UK book: AAVE, BNB and POL (window A) and ETC
  and LTC (window B) pass the four tests at both costs and fail only the
  $100k-a-day book.

**So Binance changes no verdict**: moving the row there would not move its
worst window, decide SUI's seat or admit a coin. It is not a recommendation to
move anything, and says nothing about Binance serving a UK account, custody,
funding or USDT against USD. The spreads are one night's (02:21–03:08 UTC), and
a $20 order is not inside the touch on every pair at every moment (AAVE, HBAR,
POL), which the script's own comment overstates.

### 3.23 A strategy of Revolut X's own: maker-only rules — none passes (2026-09-23)

Davies asked for a strategy that uses what is unique to each venue, since the
same rule on two venues means little. Revolut X's one unique asset is its fee:
0 % for a resting order against 9 bps for one that takes the touch. So the
question was whether a rule built to REST — buying pullbacks with post-only
bids that fill only when the bar trades through them — earns what the trend
rule cannot (`backtest_maker.ts` → `backtests/maker.json`; pre-registration and
report `reviews/2026-09-23-maker-only-{prereg,study}.md`). Six candidates: an
RSI(2) pullback, a lower-Bollinger-band reversion and an ATR dip in an uptrend,
each on 1 h and 4 h bars, on BTC/ETH/SOL (AVAX secondary), against a matched
null of random entries with the arm's own counts and holding times. **None
passes the bar**, which asks for return > 0, drawdown < 35 %, the arm above its
null's 95th percentile and half its grid positive, on windows A AND B in every
evaluation priced there. Every window-A sleeve is negative but one (+0.1 %, which
fails the null and the plateau); rsi2-1h passes window B on Coinbase's tape and
loses it on Kraken's, whose hourly lows differ from Coinbase's by a median of
3–4 bps — the edge is no larger than the disagreement between two tapes, and
requiring 10 bps of trade-through turns three of the four positive A/B sleeves
negative. The zero fee is real money (7.6–96.2 points of a window against the
same fills at taker cost) and still not an edge. Half the live row and half the
best candidate makes the worst window worse (window D ret/DD −0.77 against
−0.50). Nothing is seeded; the maker probes (`0042`) are what could reopen it.
One descriptive line is flagged and not a finding: AVAX on the UK book reads
+1,937 % in window A where Kraken's tape reads −30 %, most likely an artefact
of the UK candles' wicks (its UK lows sit a median 20 bps from Kraken's, BTC's 3).

### 3.24 A strategy of Binance's own: cross-sectional momentum over a broad universe — none passes (2026-09-23)

Binance's unique asset is breadth: hundreds of USDT pairs where Revolut X's UK
book has a handful worth trading. So the question was whether a long-only
weekly rotation into the strongest coins of a broad universe earns anything
(`backtest_xsmom.ts` → `backtests/xsmom.json`; pre-registration and report
`reviews/2026-09-23-binance-xsmom-{prereg,study}.md`; data pipeline
`docs/agents/scripts/xsmom/`). The universe is point in time and includes the
dead: every USDT pair in Binance's bulk archive (735, delisted ones included),
the top 30 by 30-day quote volume among pairs at least 100 days old, less
leveraged tokens, stablecoins and tokenised stocks; 287 pairs pass through it
and 70 of them have since been delisted. Seven candidates (no filter, a BTC
regime filter, own-return and 100-day-average filters and their combinations,
and all 36 grid points chosen in sample), 10 bps a side plus half the measured
spread, weekly. **None passes**: no candidate is positive in both window A and
window B, every worst window is −64 % to −79 % and below its matched null's 95th
percentile (P 0.965–0.998) — momentum picked coins that did worse than random
picks with the same exposure — and every candidate breaks the 35 % drawdown limit
in at least three windows. Chance expected 0.002 passes. The reason is the
universe: the top 30 equal-weighted lost 71 % in window A and 53 % in window D,
last week's winners tended to reverse, and the four majors on the same engine
beat every candidate in B, C and D. Half the live row and half the best
candidate has a worst window of −36 % against the row's −7.8 %. What it does not
test: short or market-neutral books (closed to UK retail), and other
cross-sectional signals — reversal and low volatility are untested, and testing
them is a new search with its own pre-registration.

**So neither venue has a strategy of its own that the evidence supports, as of
2026-09-23.** What differs between them is cost and reach, not a rule: Revolut
X's 0 % maker and 9 bps taker on a thin UK book, Binance's 10 bps on deep books
and a broad list. The row that trades stays where §3.11 and §3.22 put it.

### 3.25 Binance's universe, second search: reversal and low volatility — none passes (2026-09-23)

§3.24 left two cross-sectional signals untested, and this is that search, the
second on the same universe (`backtest_xsrev.ts` → `backtests/xsrev.json`;
pre-registration and report `reviews/2026-09-23-binance-xsrev-{prereg,study}.md`;
an independent Python re-implementation, `docs/agents/scripts/xsmom/verify_xsrev.py`,
reproduces every candidate's daily equity path to the JSON's rounding). Everything
but the signal is §3.24's, and the run refuses to start unless it first rebuilds
`xsmom.json`'s universe, benchmarks and incumbent byte for byte. Six long-only
weekly candidates: reversal (the five coins with the lowest 7-day return), the
same under the BTC regime filter, and the in-sample choice over k × lookback;
low volatility (the five with the lowest 30-day volatility), the same filtered,
and the in-sample choice over k. **None passes: all six lose money in window A**
(−4.8 % to −78.4 %), so none is positive in both A and B. Reversal's worst
windows (−54 % to −78 %) are below its matched null's 95th percentile (P
0.76–0.93), and every reversal grid point lost 51–92 % in sample too. Low
volatility's worst windows (−5.9 % to −25.6 %) do clear the null (P ≤ 0.007), but
the null matches exposure and turnover, not volatility: BTC, BNB, TRX, ETH, XRP
and LTC fill 71–98 % of its slot-days, and BTC held alone beat it in B, C and D.
Chance expected 0.009 passes, and 0.011 across both searches' 13 candidates.
Half the live row (BTC/ETH/SOL/AVAX) and half the filtered low-volatility book
has a worst window of −6.9 % against the row's −7.8 %, which random picks match
in 0.8 % of draws, but the rule counts a combination only for a candidate that
passes. Rebalancing that book on Thursday or Friday instead of Monday makes it
positive in all four windows; choosing a weekday after seeing the windows would
be a third search, and it breaks the 35 % drawdown limit in two windows anyway.

**So both ends of last week's move lost to random picks on this universe** —
§3.24's winners and §3.25's losers — and what separated the coins was
volatility, not direction: the calmest coins, which are the largest, beat
random picks and still lost the bear year. The verdict above §3.25 stands: no
venue-specific rule.

## 4. Design consequences (decided by the evidence above)

1. **Jev is a decision node, not a strategist.** Code computes indicators, regime, position and risk; Jev sees ≤ 1–2 k tokens of categorical state and answers typed questions; a deterministic risk layer has the last word. Anything else contradicts the vendor's own jaggedness page.
2. **Observe every minute, decide on closed bars.** The loop wakes every minute (pg_cron; one minute is where Revolut X's public token bucket and the Edge budget both stay comfortable): it refreshes both venues' quotes, manages and re-quotes resting orders, checks the protective stops against the live mark, and writes the categorical state on the FORMING bar down when it changes (`agent_observations`) — so the page shows what the market is doing between decisions. Entries still wait for a closed 1h / 4h / 1d bar (the one rule that decided on the minute, the dislocation rule of §3.5, was retired by `0038`). "Every second" would cost nothing on Jev and everything on fees and the 1,000-order cap — §3.6 puts the number on it: below an hour the round-trip cost is the whole result.
3. **Each venue fills the way its fee allows.** On Revolut X every order takes the touch (9 bps): that is the fill the backtests assume, and a bid resting on a breakout fills exactly when the breakout fails (§3.5 measured that adverse selection). On Kraken orders rest post-only at the touch, stops included (at the ask, walked down by the re-quote), because 80 bps a side is not worth certainty at this size.
4. **BTC, ETH, SOL only** — the only pairs on this venue with ≤ 3 bps spreads and real volume. Everything else costs 3–8× more per round trip.
5. **Paper first.** Every strategy runs in shadow mode against live prices, recording the orders it *would* have placed, until its paper record is shown; the switch to live is a per-strategy flag Davies flips, and the first live order requires his explicit confirmation.
6. **Hard, code-enforced caps** the model cannot touch: max notional per order (the row's own slot, with 10 % room — item 26), max open exposure, daily loss limit (kill switch), max orders per day well under 1,000, and a global pause flag in the database.
7. **Record inputs, not conclusions** (the `snapshot-record` lesson): every Jev call's state, questions and answers, and every order's request/response, are stored; P&L is computed in one place from fills and marks.
8. **Two venues, each for what it is good at** (§2b, §2c). Revolut X executes (0 % maker); Kraken supplies the signal (`signal_venue`: its candles are the cleaner series) and runs paper twins whose fills pay its real fee. There is no arbitrage between them at any cadence available here — measured, not assumed — and the basis keeps being recorded so that stays true or is seen to change. Caps in `agent_risk` are per venue account and per mode.
9. **Capital utilisation is a consequence of regime, not a target.** The rotation rule holds the strongest two of four whenever they trend; in a broad bear it holds cash, because the alternative lost 45 % out of sample (§3.4). The switch that makes it always-invested exists and is Davies' to flip, with the number beside it.
10. **Nothing fast, except what the data earned — and nothing did.** A 1,000-order day on Revolut X and 40–80 bps a side on Kraken rule out market-making and cross-venue trading. The fastest rule is the 1-hour trend variant (paper, for feedback speed). The dislocation rule (§3.5: taker entries when Revolut X's touch sat ≥ 15 bps under Kraken) was seeded as a measurement and retired by `0038` after its one trade, which turned out to be the other region's book (§3.5, §4.14): a UK account cannot lift an EEA ask. §3.6 tried 15-minute and 1-hour bars with the loop's own fills: at 15 minutes the best parameters lose on every coin, in sample and out, because ~300 round trips a year at 20 bps each is 60 % of the account. A faster rule is a fee schedule, not a strategy, until data says otherwise.
11. **Stops run between bars, entries do not.** The floor under cost is checked every minute against the live mark and sells without asking the model; an entry is never taken between bar closes. **There is no intra-bar ATR trail, since 2026-09-21** (§3.13): the trail that ran here was the trail `ruleDecision` already applies to the CLOSE, from the same anchor with the same multiplier, and the per-minute copy always fired first — 48 of 49 protective exits in one walk-forward window, 67 of 68 in the other, which made the rulebook's own trail near dead code and cost SOL ten points and ETH four in the year it was not needed. Switching it off is better on 8 of 10 coin-windows; the rulebook's trail now does the work it was written to do, on closes. **A retired row that still HOLDS something keeps its exits** (2026-09-22). `0038` retired `dislocation-1m` flat and nothing was left behind, which is why nobody noticed; `0043` retired three rows that were still long, and under the old rule their positions had nowhere to go — the tick skipped a paused row, so no floor and no rule exit ran, and the page hid it. Two things were wrong and both are fixed: the tick now reads retired rows, derives the book, and keeps running the EXITS of any that still hold (`windingDown` in the report; a retired row that is flat is skipped before any decision work, as every earlier turn did to all of them), and **`riskGate` no longer refuses an exit to a paused strategy** — that test sat ABOVE the `action === "enter"` branch whose own comment says an exit is never refused, so a paused row's position was held by the very gate that exists to let positions out. A position does not stop being a position because its row was switched off. The GLOBAL pause still outranks an exit, because that one is a person's emergency switch and means everything. The page shows a winding-down row until it is flat, then it disappears; the page's totals are unchanged, because a retired row that is already flat is filtered out before the aggregates are summed. **As of `0044` there are no retired rows at all** — Davies had the four of them deleted with their history — so nothing exercises this path today. It stays because the next row retired while holding something will need it, and because the `riskGate` half of it (a paused strategy may still EXIT) is a correctness fix regardless. **The thin-book guard, built 2026-09-22** (ledger item 0b, open since the region bug): two halves pointing opposite ways on purpose. A long position's stop is now judged at the **BID** (`exitMark`), not the mid — the stop has always been checked against the mid and filled at the bid, which is half a spread of wishful thinking (0.75 bps on BTC, 21 on SUI, unbounded if the book goes wide) and which says a position is above its floor while the money available for it is below. And an **ENTRY is refused when the book is wider than 50 bps** (`WIDE_SPREAD_BPS`), because every Revolut X entry crosses and pays the ask, so a wide book charges its width as a fee on top of the 9 bps; the measured UK book is 1.5–24 bps and the EEA book this account cannot trade was once seen at 180 (§2.2, §4.14), and a quote that wide is either a real dislocation or a broken feed — an entry is worth neither, and an entry can always wait for the next bar. **An exit is never refused by the guard**: a stop exists for exactly the minute the book is ugly. The width is written onto the decision row (`bookBps`), so a refusal is auditable rather than invisible. The floor stays intra-bar and is the crash protection — and §3.3a's re-run shows it never fired at all on BTC, ETH or SOL in the out-of-sample year, so what the tables used to call "the stops" was one stop. A resting exit order never outranks a stop: when the stop fires it is cancelled first (on Revolut X the sale is then marketable; on Kraken a stop already resting at the ask is left to work). A stop is claimed on the minute, so one that lapses is tried again next minute, not next bar. After ANY exit a rule waits two of its own bars before buying again — §3.3a shows why. The backtester runs the same stops and the same cooldown, so the tables describe the shipped rule — true of every rule from 2026-09-20 and of the ROTATION rule only from 2026-09-21, when the pre-live review found `runRotation` had neither and §3.4 was re-run with both (the sentence is left standing and corrected here, so the record shows what was claimed and when it was found wrong).
12. **One turn at a time.** pg_net fires the next minute's tick whether or not the last one finished; a turn takes a lease (`agent_locks`, compare-and-set on its expiry, 55 s) and a turn that finds it held does nothing. The bar claim protects decisions; the lease protects everything else.
13. **The model is asked on entries only.** It can veto one; it never advises an exit, and the seeds, the page and the README say exactly that. A partially filled live order is a position from its first fill (stops and caps see it); a venue-cancelled order that had filled in part is recorded as a fill of that part; a live order that filled on arrival is settled from the venue's own view next turn, fee included — never from the placement reply.
14. **The venue's market data is the account's region, always.** Revolut X keeps two books per pair (UK / EEA) and this account trades the UK one; a quote or a candle from the other book is not a price this account can get, and reading one produced the only trade the dislocation rule ever made (§3.5). Every public call names `region=UK`, a row from another region is dropped, and the probe shows which book the loop is reading. The same discipline applies to any venue that publishes more than one book, and any fact of that kind written into this reference is a requirement on the client with a pin, the day it is written.
15. **A coin joins a rule by a bar written before the numbers, never after.** §3.7's four tests — positive out of sample on Revolut X costs, drawdown under 35 %, at least half the parameter grid positive out of sample, positive on Kraken costs — decided AVAX in and LINK, DOGE, ADA out. §3.8 tightened it: the four tests on BOTH walk-forward windows (parameters on the first two thirds with the last third out, and parameters on the first third with the middle third out), and a Revolut X UK book of at least $100k a day, because a bar judged on one year is itself a fit to that year. Under the tightened bar SUI joined and six one-window passes did not; the same bar applies to the next candidate, and lowering it for a coin that nearly clears it is the overfit the friend's message warns about. The plateau share is reported for every coin and is the number to quote when someone says every strategy is sensitive to its parameters: sensitivity is a spike, robustness is a plateau, and both are measurable. **The bar admits a coin; it does not certify the ones already in.** It is what a NEW coin passes to join a row, and it is not a description of the coins already in one: §3.10 found that of the 21 shipped strategy × coin × venue members **not one clears it on both windows** — BTC, ETH, SOL, SUI and AVAX each clear one window and fail the other, and they disagree about which, which is the entire reason the five-coin sleeve is steadier than any of its parts. **CORRECTED 2026-09-22**: that sentence is the `trail` regime — the intra-bar ATR stop the loop STOPPED RUNNING on 2026-09-21 (§3.13). Under the stop rule `tick.ts` actually runs, `tape.json`'s §T3 says something different: on Revolut X costs, at the seeded point, with both tapes agreeing, **AVAX clears A, B AND C**, SOL clears A and C, ETH B and C, BTC B and D, and SUI clears A alone — and AVAX is the ONLY coin of the 27 priced that clears BOTH walk-forward windows. **That is not a qualification, and it must not be read as one.** Across the 93 coin-window cells priced under the shipped rule, 26 clear the bar: a per-window pass rate of **0.280**. Twenty-three coins have both A and B priced, so the null expectation for coins clearing both is 0.280² × 23 = **1.80**, and P(at least one by chance) is 0.85. One passer is FEWER than chance gives. So the bar admits AVAX where it admits nothing else, and the bar's own control says one admission out of twenty-three is noise — which is exactly why this item says a member's own record is not the argument. The argument for AVAX's seat is the SLEEVE's record (§3.19: removing it buys +0.57 in the sideways year and pays −2.35 in the strong bull and −0.56 in the bear), and that is unchanged. What changes is the reason: it is not "no removal helps", and it is not "AVAX is the strongest coin". It is that AVAX is the row's largest concentration in BOTH directions — roughly 95 % of the sideways year's loss and 57 % of the strong bull's gain — and the sleeve is steadier holding it than dropping it. The live recommendation therefore rests on the SLEEVE's two numbers (§3.11: −0.3 % in the bear window, +12.6 % in the bull) and on leave-one-out, never on a member's own pass. **AVAX is not an exception to this**; it is the case where the failure happened to be written down, because `0039` added it the morning the bar tightened (§3.8), while BTC and ETH were admitted by §3.7 on spread and book before a second window existed and were never re-read against the tightened bar in the same sentence. Quoting AVAX's failure without BTC's and ETH's is the misreading this paragraph exists to stop. In short: the bar governs ADDITIONS and paper promotions, the sleeve number governs money, and neither is evidence for the other. **And a ONE-window pass is not partial credit — it is noise, measured (§3.15).** With a third window built from Kraken's own history, zero or one coin of 22 clears the bar on all three, against a null of 0.33–1.50, on every venue × parameter × stop-rule arm, and the whole windows-cleared histogram matches the null. Worse for the idea: across all four arms a coin that cleared window A was LESS likely to clear window B (0.000–0.200) than a coin that failed it (0.421–0.611). So there is no ladder from one window to a seat: a coin either clears the bar on the windows it has, or its record is a coin flip, and paper seats are for measuring EXECUTION — fills, slippage, the venue's behaviour — not for letting a one-window coin accumulate a return record it would take years to read. This is the answer to "if one window earns a seat, why not the other ten coins that cleared one": none of them, and the ones already in are in on the sleeve's number, not their own. **There is now a number on how unstable the per-coin test is** (§3.16): swapping the price series for the one the loop actually reads flips this bar's verdict on **5.9 % of coin-windows** (13.2 % on chosen parameters) and moves a single coin's bear-year return by up to thirty points, while moving the five-coin sleeve by about one. The bar is applied where the measurement is least stable and the sleeve is where it is most stable — which is the strongest argument in this document for deciding money at sleeve level and letting the bar only admit.
16. **A coin one venue lacks runs on the other alone.** Davies (2026-09-21): the two venues' strategy lists need not be synchronous — a coin Revolut X does not list, lists only on the EEA book, or lists on a UK book under the $100k-a-day floor may run on Kraken alone, and the reverse holds. Nothing in the loop assumes the lists match: each `agent_strategies` row carries its own symbols (`0039` / `0040` appended to each row separately), the tick works one row at a time and the page reads positions per row. The bar does not move for a single-venue coin: the four tests on both windows on THAT venue's costs and a book on that venue of at least $100k a day. On Kraken the costs are 40 bps maker each side — 80 bps a round trip before the spread, against ~20 on Revolut X for the majors — so a Kraken-only coin needs a larger edge, not a smaller one, and the 4-hour rule is the only rulebook whose trade count can carry it (§3.6). Such a coin joins `trend-4h-kraken` by its own migration, paper first. Candidates are the coins §3.8 could not test on Revolut X (ZEC, XMR, TRX were named there); their Kraken series go through the same script before any is proposed. §3.12 has since measured Kraken's book for all 27 coins and priced the eight whose UK book is under the floor on the SEEDED parameters — what a coin joining the row would actually run (`kraken.json`, `krakenOnlySeeded`). **POL is the only one worth a second look**: Kraken book $2.30m a day, spread 9.0 bps, `ordermin` 50 POL ≈ $5.59, window A **+33.0 %** with a 17.7 % drawdown on a **100 %** plateau over 7 trades, window B **−5.2 %** (DD 19.3 %, plateau 51.9 %, 14 trades). That is one window, not two, so **the bar as written does not admit it and it has not been added**. It is recorded here because its record is the same SHAPE as AVAX's — one window each, the bear one — and the two must not end up treated differently by accident: AVAX sits in a row because Revolut X carries it ($1.9m a day) and POL sits in none because Revolut X does not ($11k a day, a tenth of the floor), which is a liquidity fact, not a verdict on the coin. Whether a one-window coin may hold a PAPER seat to build a record — which is exactly what §3.8 granted AVAX — is a question about the paper rows and Davies' to answer; until he does, POL stays out of every row. BNB, TON, SHIB and ETC each clear one window on Kraken costs on shorter histories or thinner books; LTC, AAVE and ATOM clear neither. **Closed 2026-09-21 by §3.15**: POL fails window C on BOTH venues and BOTH parameter sets on a 0 % plateau (Kraken −20.6 % / −18.8 %), so it is not a one-window coin waiting for a rule — it is a coin that fails the third window it was given. No paper seat, and the asymmetry with AVAX is resolved by measurement rather than by a decision. §3.15 also answers this item's other named candidates from §3.12's side: ZEC, XMR and TRX each clear one window and none clears two.
17. **The pre-live review, and what was done about it (2026-09-21).** An independent review of every agents file — the loop, the venue clients, the strategy module, the migrations, the page — is `docs/agents/reviews/2026-09-21-prelive-review.md`: seven blockers, sixteen should-fixes, twelve missing tests, the doc gaps. Shipped with pins the same day (`tick.test.ts`, `revx.test.ts`, `index.test.ts`, `strategy.test.ts`): **B1** a `pending` row the venue does not list STAYS pending — a marketable order fills or dies inside the turn, so its absence from the active list proves nothing — reported every turn with the venue's balance beside what the record holds, until a person settles it from the venue's history; **B2** a cancel whose read-back fails leaves the row open for the next turn to settle from the venue; **B3** the fills query is paged (`selectAll`; PostgREST stops at 1,000 rows without a word — the tick and the dashboard both read the whole book); **B4** `orderViewProblem`: a filled Revolut X order whose reply lacks `filled_size`, `average_fill_price` or `fees` is an error, never a fill at fee 0, and the probe now reads `/1.0/orders/active` and Kraken `ClosedOrders` and reports the field names each venue returns — the first live order's read-back is the verification, and until then those three names are the client's assumption, not a fact of this reference; **B5** a re-quote goes through `riskGate` like any order (global pause included); **B6** an allowed decision whose order never reached the book is placed on a later turn, the bar's claim staying with the decision, and migration `0041` makes the order insert the claim on the attempt so two turns' retries are one order; **B7** the lease is released by its holder only, renewed once past half its length, and a turn past 70 % of it opens no new bar decision (stops and observations are never deferred); **S1** the snapshot and the bar rule read the high-water trailed to the market, so the state's `drawdown_from_high` and the ATR clause match the backtester (the per-minute stop always did); **S3** a symbol with no quote and no candle has no mark, not a mark of 0; **S4** a protective decision claims one second into its minute, never a bar start; **S5** an open buy's unfilled notional is exposure now; **S6** the model's exit-advice branch is gone — Jev can veto an entry and nothing else (the rows' `exitMax` parameter is inert); **S8** `lookbackDays` moves the momentum window; **S9** a cached series must be contiguous to count as warm; **S10** the execution venue's 1-minute candle is fetched only where a paper order rests (the public Revolut X calls a turn are tickers and pairs plus one per resting paper order — four with none resting, against the eight §4.2's "half a dozen" had grown to); **S12** the probe checks every symbol on an active row; **S16** today's P&L is summed strategy by strategy from each one's signal venue's day open, in the tick and on the page alike. **S2** — `runRotation` now takes the same `StopParams` `run` takes and the rotation rows' figures were re-run with the floor and the cooldown the loop applies to them (§3.4, rewritten; `latest.json` / `summary.json` regenerated; pinned by `backtest.test.ts`), and the answer was worth having: **the 8 % floor makes the rotation rule worse on five variants of six**, which no table said before because no table ran it. **Retention, decided rather than left open** (the review's last doc gap): `agent_decisions` and `agent_orders` are kept INDEFINITELY and pruned by nothing — they are the record the whole design rests on, ~175 rows a day between them, so a year is under 70k rows and the storage is not the question. What made an unbounded table dangerous was reading it unpaged, which B3 fixed; `0037`'s prune covers only the bulky, reproducible tables (30 days of basis and observations, 120 days of candles, 3 days of minutes). If a prune is ever wanted here, it archives rather than deletes: a fill that is gone is a position that never existed. **Not done, and said so**: **S7** is done in code (§4.18: one nonce sequence per isolate, pinned) with the venue-side half — a nonce window on the key — named as a prerequisite for the first live Kraken order; **The whole should-fix list is closed as of 2026-09-22, and the record of it was wrong.** **S11** was done that day and was not only a page problem: a paused row holding a position had no exit path at all, in the tick OR in `riskGate`, which `0043` turned from a review note into three real stuck positions (§4.11). **S13** (the dashboard refresh race), **S14** (unmasked sizes) and **S15** (the missing live-unconfirmed alert) were all shipped earlier and this paragraph simply never said so — checked in the code on 2026-09-22: `newestWins()` guards both the render and the module cache and `loading` is set only on a manual refresh or a cold open (S13); `sizeText(base, m)` masks every size on the page, and its own comment says why — a size beside a mark is the value (S14); `agentsAlerts` raises `live-unconfirmed` when any row is live and `live_confirmed_at` is null (S15). A list that says a thing is undone when it is done is the same failure as the reverse, and it was two lines from a go-live decision. **The sweep fixture** is refreshed to the post-`0043` payload the same day: four rows rather than seven, `makerProbes` in it, and the three assertions that had hard-coded seven rows corrected with it (208 checks green). Also corrected that day, and worth naming because it had gone the other way: the `paused-long` alert still told a reader that nothing protects a paused row's position, which stopped being true the moment the tick started winding those rows down — it now reads as `winding-down` at a `paused` tone when the payload carries the flag, and stays a fault when it does not, because the flag is the evidence that the exits run and the page must not assume protection it cannot see; §4.11's sentence stands corrected here rather than rewritten, so the record shows what was claimed and when it was found wrong.

18. **One nonce sequence per isolate, and a nonce window on the key before Kraken goes live.** Kraken's private calls need a nonce that only ever goes up for a key (§2b: repeated bad nonces get the key banned for a while). `loadKraken()` built a fresh generator per REQUEST, so a dashboard load (balances, fee tier) and a tick in the same isolate, in the same millisecond, minted the same nonce — reproduced in `kraken.test.ts`, two generators seeded from one clock returning one value. Every private call now draws from a module-level `krakenNonce`, so the sequence is strictly increasing whatever else is in flight. What code cannot fix is a COLD isolate starting inside the same millisecond as a warm one's last call: that is closed at the venue, by setting a **nonce window** on the key in Kraken's API settings (a few seconds is enough), and it is a prerequisite for the first live Kraken order alongside the GBP → USD conversion. Until then Kraken rows are paper, where a rejected private call costs a log line.


19. **The pre-live verification, and the defect it found (2026-09-22).** Run against production before any mode flip, with the ledger's four rows all paper and `live_confirmed_at` still null. **The blocker: a position did not carry the mode it was opened in.** `tick.ts` keyed the book on `strategy_id|symbol` alone and bucketed its exposure from `rows[0].mode` — the FIRST fill's. A row flipped from paper to live therefore inherited its paper positions: the rulebook would read itself already long (`ruleDecision` only holds or exits while `position.base > 0`), never buy the coin for real, and the first time an exit or the 8 % floor fired would place a REAL sell at Revolut X for base the account never bought — while that blended position was billed to the PAPER cap. `trend-4h` was holding BTC, ETH and SOL on paper at $13.33 a slot when this was found, so the flip was one migration away. The mode is now part of the key (`posKey`), and one resolver — `bookKey` — hands both the position and the fill history to the row's current book, so the re-entry cooldown reads the same book its position came from. A PAUSED row is the one exception and keeps `0043`'s behaviour: it is not a book of its own, it is whatever it was when it took the position, so it still sees it and still runs its exits. Pinned three ways in `tick.test.ts` (a live row starts flat, sells nothing and enters with live money; a paused row keeps its floor), counterfactual checked — drop the mode from the key and the first test goes red. **The consequence for going live**: flipping `trend-4h` in place is now safe but strands its three paper positions, which no rule would manage again and which the page would show under a live row, so the draft migration (`docs/agents/0047_go_live.sql.draft`, deliberately NOT under `supabase/migrations/`, where a push applies it) adds `trend-4h-live` as a new row and leaves `trend-4h` paper as its control — the only thing that can measure a live Revolut X fill against the paper assumption of the touch plus 9 bps, which `trend-4h-kraken` cannot do because it measures Kraken's post-only fills. **`min_order_size_quote` for AVAX and SUI is measured** (§3.13's fourth caveat, and the assumption under every $20 slot on those two): `GET /1.0/public/configuration/pairs` is PUBLIC and keyless, 455 pairs, and all five live coins are `active` with `min_order_size_quote` **$0.10** and `max_order_size_quote` $1m (BTC/ETH $10m) — a $20 slot is 200× the floor. Price and size steps are honoured by the code already (`ceilToStep`/`floorToStep` on `quote_step`, `sizeBase` flooring to `base_step` and checking both minimums); the worst rounding residue across the five at live prices is $0.0005, on BTC. Live UK touch the same minute, one row per symbol with the region filter honoured: BTC 1.6 bps, ETH 3.2, SOL 4.2, AVAX 9.1, **SUI 25.7** — all inside the 50 bps `WIDE_SPREAD_BPS` refusal, and SUI's 25.7 plus 9 bps of taker each side is 43.7 bps a round trip, which is the ~42 bps §3.8 priced it at. **The exposure cap is marked to market, not costed.** `exposure += base × mark`, and `max_exposure_usd` was $100 against a $100 row: four slots up 6 % put the book at $84.80 and the fifth entry is refused at 104.80 > 100, so the cap tightened exactly when the rulebook was working and loosened after a drawdown. It cannot be a loosening of risk to raise it — the rulebook does not pyramid, so five coins at a $20 per-order cap deploy at most $100 of capital whatever the number says — and the draft sets $150, leaving the fifth slot reachable after a 50 % run in the other four. Pinned in `strategy.test.ts` at the exact boundary ($80 + $20 passes, $80.01 + $20 does not). **Production health, same day**: 1,440 of 1,440 minute ticks fired in 24 h with no gaps, every HTTP response in the retained 6-hour window a 200 (360 ticks); 137 decisions, **none** with `provider: none` — Jev answered every one — and none refused by the risk gate; three agent errors in 48 h, each a single occurrence and each understood (a network timeout at 02:17 that the next minute healed, a Kraken altname cache cold for AVAX the minute `0039` added it, one Kraken ETH candle timeout), none in the last eleven hours. AVAX and SUI are decided every bar and read "no close above prior 55-bar high": they have never entered because the rule has not fired, not because anything is broken. **The probe was then run, 14:05 UTC, and it is green.** Fired through `pg_net` from inside Postgres — the method the 2026-09-21 probe used — so the operator secret goes from the vault into the header without leaving the database. **Revolut X**: key loads (`pkcs8-b64`); balances 200, one sub-account row; the SIGNED `/1.0/configuration/pairs` 200 with 393 pairs against the public endpoint's 455 (the account's tradable subset) and **all five coins present and `active` at $0.10**; the signed call **with a query string** 200 — the part of an Ed25519 implementation most likely to be wrong, and it is right; `/1.0/orders/active` 200; region UK with five ticker rows, one per symbol. **Kraken**: secret decodes to 64 bytes; Balance and BalanceEx 200 and **the account holds USD and no GBP, so §4.18's conversion prerequisite is confirmed done at the venue**; TradeVolume 200 confirming **0.80 % taker / 0.40 % maker at $0.00 of 30-day volume**, next tier at $2,500 (maker 0.30 %) — the venue's own confirmation of §3.12's fee arithmetic; OHLC 200 with 721 rows, which is the 720-bar ceiling plus the forming bar the endpoint always appends; OpenOrders and ClosedOrders 200 and empty; **`AddOrder validate=true` 200 with `txid: null`** and the order echoed, so the whole placement path is verified without an order existing. **Jev**: both transports answer with no errors and AGREE on the same state (calm 0.97 / 0.98, caution 0.08 / 0.08, positive 0.98 / 0.99), 463 ms and 662 ms, ~$0.0000184 a call — the fallback is real. **What no probe can verify, and it stays open: B4.** Both order histories are empty, so `activeOrders.fields` and `closedOrders.fields` both returned `[]` — the settlement names `filled_size`, `average_fill_price`, `fees`, and whether Kraken echoes the client order id, remain the client's assumption until the FIRST LIVE ORDER's read-back. A filled order missing them is refused rather than recorded at fee zero, which is the guard; nothing short of a real order closes it. **A venue measurement worth keeping from the same minute: Kraken's book is 3–5× TIGHTER than Revolut X's on every one of the five coins** — BTC 0.01 bps against 2.4, ETH 0.76 against 2.7, SOL 1.7 against 3.8, AVAX 2.73 against 9.1, SUI **4.94 against 23.7**. It does not change the venue verdict, because the arithmetic that decides it is fees: Revolut X's worst round trip is 18 bps of taker plus 23.7 of SUI spread = 41.7, against Kraken's 80 bps of maker fee resting at no spread at all. But it is the first time the two books have been measured side by side at one instant, and it says the fee schedule — not the liquidity — is the whole of Kraken's disadvantage.
20. **The independent pre-live code audit, and the kill switch that was not one (2026-09-22).** A second adversarial review, run against the tree after §4.19's fix, found that **there was no working way to stop a live row that still held coins** — three mechanisms, each independently broken, each reproduced against the real code. **(a) `live_confirmed_at = null` refused EXITS.** The check in `place()` (`tick.ts`) tested only `s.mode === "live"` and the confirmation, never the side, and it sits AFTER `riskGate` has already allowed the exit. So the documented emergency procedure — the one sentence in `go-live.md` that says to reach for it before anything else — would have left real coins with no floor and no rule exit, writing one decision row and one `ops_errors` row per minute per symbol while the record said the exit was allowed. It is side-aware now: a live BUY needs the confirmation, a SELL does not, and `global_pause` remains the single switch that outranks an exit. **(b) A paused row's exit order violated the schema, so the whole `windingDown` fix was INERT in production.** `agent_orders_mode_check` is `in ('paper','live')` — and `agent_maker_probes_mode_check` with it — while the tick wrote `mode: s.mode`, which is `'paused'` for exactly the rows `0038` and `0043` retired. `agent_decisions` has no such check, so the decision landed and the ORDER was refused by Postgres; the error carries no `409|duplicate|unique`, so it was swallowed into `report.errors` and the turn moved on. The page meanwhile told the owner "its floor and its rule's own exit still run every minute". **The repo's own tests could not catch it, because the in-memory stub did not enforce CHECK constraints** — three winding-down tests asserted a sell that production rejects. The stub now enforces the mode check, and reverting the fix turns those tests red. **(c) A live row demoted to `mode = 'paper'` — offered as an undo — read itself flat**, so its real coins lost their exits while it started buying on paper beside them. All three share one root: **a row's `mode` LABEL and the book it is actually trading are different things.** They are now separated: `bookMode(s, sym)` resolves the book — **real coins outrank the label**, otherwise the row's own mode, a paused row falling back to paper — and the order row, the decision row, the maker probe, the exposure bucket and `limitsFor` all follow the BOOK, while `riskGate`'s `ctx.mode` keeps the LABEL, because "may this rulebook take new risk" is the question that one asks. `offBook()` generalises `windingDown` from "retired" to "holds a book it does not trade", and refuses those rows' entries. **Two more holes left a real position unprotected.** An order that could not be read back or cancelled blocked its pair's protective stop **every minute, indefinitely** — and an unreadable filled order is precisely what B4 produces if the settlement field names are wrong, so the first live order could both fail to settle and disarm the stop on the coin it had just bought. A `pending` row, which is what a venue timeout produces, did the same. **A buy is not the exit**: the stop now cancels a blocking buy if it can, says what it is stepping past if it cannot, and sells what is held either way; only a SELL in flight still stands it down, because a second sell over one that cannot be seen could oversell. **The dashboard had not been given §4.19's fix** — `index.ts` still keyed `strategy_id|symbol` with no mode and billed `byMode` from the row's label, so a row that ever changed mode drew one position out of two books and the whole blend landed under "live realised", the headline number for real money made. It now resolves the book exactly as the tick does, bills each position to its own book, computes today's P&L per book, and pages the chart's fills. **Four smaller fixes**: a reply that says `filled` while reporting `filled_size: 0` is now a problem rather than a fill of the whole order at fee zero (an ABSENT field still reports as absent — the distinction cost one test); `positionFromFills` sorts to a TOTAL order, buy-first at a tie, because `applyFill` clamps an over-sell to flat and the wrong order at a tie silently destroys a position; `stepDecimals` reads a step given in exponential notation, since `split(".")` found no fraction in `"1e-8"` and `toFixed(0)` turned half a coin into one (no venue sends that today — a guard, not a fix); and a paused row is refused before `askJev` is paid rather than after. **Migration `0045` makes `agent_maker_probes` cascade**: it is a THIRD child of `agent_strategies`, and `0044` — itself written after `agent_orders` turned out to have two foreign keys — did not delete it. It survived on luck, because the only three probe rows belonged to a row that stayed. Probes cascade because they are a measurement notebook and can be re-measured; `agent_orders` and `agent_decisions` stay EXPLICIT because a fill that is gone is a position that never existed, and a forgotten one should fail loudly, which is what happened. **The go-live draft is corrected and renumbered — now `docs/agents/0047_go_live.sql.draft`, since `0045` and `0046` were taken by the probe cascade and the Kraken twin's deletion**: its TO UNDO said both of the false things above, the flip-in-place alternative is struck rather than discouraged, the row is written out in full instead of copied with `select` (verified byte-identical to the paper row's params in a rolled-back dry run) and `on conflict do nothing` is gone, so a re-run FAILS rather than quietly arming `live_confirmed_at` beside a row of unknown shape. **The audit's reasoned-but-unreproduced list was then worked through on Davies' word ("这里面你认为该修的也都修了"), and five of seven were fixed.** **The lease renewed exactly ONCE**, which bounded a turn at about half a lease plus a lease; past that the lock expired under a turn still placing orders and the next cron minute ran beside it. It now renews whenever the lease is more than half gone, so a slow database extends the lock instead of losing it. **A fresh order with a null `decision_id` is refused**: `0041`'s index is partial (`where decision_id is not null`), so such an order carries no claim and two turns retrying it would both place — a re-quote is deliberately left alone, because it replaces a row the same turn already cancelled and settled and `MAX_REQUOTES` bounds it. **The day's open was yesterday's OPEN for the first minutes of every UTC day**: before the venue publishes today's daily candle the code fell back to the last candle and read its open, counting a whole day of move as today's, every night — which inflates `dayPnl` and can spend the $5 daily loss limit on a move that already happened. Yesterday's CLOSE is where today opened, and that is the fallback now. **A partially filled order is stamped when it FIRST filled**, not when it completes, so a position's realised/unrealised split no longer changes retroactively between turns. **Every paged read now orders by a unique column last** (`order=ts.asc,id.asc`), and `selectAll` REFUSES a query with no `order` at all: LIMIT/OFFSET paging is stable only under a total order, and a fill read twice across a page boundary is a position counted twice. Open orders are read with `selectAll` too. **Two were judged not worth the change and are recorded rather than fixed**: the exposure bucket reads `rows[0].venue`, which would misbill only if a strategy's `venue` ever changed — no migration does that, and putting venue in the position key is a change to the hot path with no path that triggers it; and a `decisionId` that is null for a re-quote, for the reason above. **The browser sweep now drives the post-`0046` shape** — three rows, the book on `trend-4h`, and Kraken with ZERO execution rows, which is the arrangement the page must handle now that it is a signal venue only. 208 checks green.

21. **Jev vetoes one entry in five, and no backtest prices it (measured 2026-09-22).** Every figure in §3 and in the go-live brief is the RULEBOOK's; the account runs `rule ∧ Jev`. `combineDecision` turns an entry into a hold when `P(healthy) < enterMin` (0.6), when caution is extreme, or when the model does not answer — and no backtest models any of that, which the reference has always said. What nobody had done was count it in the LIVE record. `agent_decisions`, every row since 2026-09-20: the rulebook produced **15** entry signals, **12** were taken and **3 were vetoed — 20 %**. They fall `trend-1h` 2 of 5, `momentum-1d` 1 of 4, `trend-4h` **0 of 3**, `trend-4h-kraken` 0 of 3. **Two of the three vetoes were P(healthy) = 0.59 against a threshold of 0.60** (SOL on `trend-1h`, two consecutive days); the third was 0.15 (BTC on `momentum-1d`). So `enterMin` is binding AT ITS BOUNDARY, and it is a seeded parameter that has never been varied, never been backtested, and gates every entry the live row will make. The live candidate's 0 of 3 is three bars and is not evidence that it is exempt. This does not argue against going live — the model can only ever make the row do LESS, which is the design — but it is a measured gap between §4's expected return and what the account will earn, and the go-live brief now carries it as §9.6 rather than reporting "0 refused by the risk gate", which was true and was not the layer doing the refusing. **MEASURED 2026-09-22 18:29 UTC — the model asked about every state it can see on an entry.** The entry state has only 90 possible values (symbol × trend_strength × volatility × momentum; trend up, breakout above range, flat and no drawdown are forced on an entry), so the new read-only `POST ?action=jev` asked the real model (OpenRouter, `typesafe/jev-1.13-20260917`) all 90 five times each: 450 calls, $0.0126, no missing answer, no echo failure. **Weak trend strength: P(healthy) 0.07–0.13, vetoed 100 % of the time. Moderate or strong with low or normal volatility: 0.94–0.97, never vetoed. Unknown momentum: 0.04–0.21, always vetoed. Moderate|high volatility: mean 0.600, range 0.55–0.62, vetoed 7 of 25. Strong|high: mean 0.598, range 0.56–0.64, vetoed 12 of 25.** Caution never reaches the 1.75 veto on an entry. Two structural findings follow. (1) The weak-trend veto is NOT a model judgment: `jevQuestions`' `healthy_trend` instructions tell the model to answer yes only when trend_strength is moderate or strong and momentum is positive, the rulebook never reads strength and enters on momentum ≠ negative, and the model complies every time — so a filter the rulebook does not have was written in prose inside a prompt and never backtested. It is the clause the earlier replay found costs the bear year most (`weak-veto-only`, window A +8.03 % → +0.63 %). (2) The high-volatility veto is a coin flip at the threshold: those states' mean P sits on 0.600 itself, and one state on one coin flips between calls (strong|high ETH answered 0.58, 0.58, 0.61, 0.63, 0.64). With `enterMin` anywhere in roughly (0.21, 0.55) the gate would be deterministic and pass every high-volatility entry; anywhere in (0.64, 0.93) deterministic and refuse them all; 0.6 sits in the middle of the only band where it is random. The re-pricing of the live sleeve on these answers — rule with the model in shadow, rule ∧ model as it runs, rule + the weak-trend clause as code, each against its random-veto null — is §4.21's next entry; the raw replies are `docs/agents/backtests/jev_answers.json`. **A second correction from the same audit, which cuts in the incumbent's favour**: the set study's four evaluations are not four independent looks on the window that decides. Window D lies entirely inside the Kraken extension on both tape arms — the study's own fidelity block proves the 84 cells are bit-identical — so the tape dimension is degenerate there, and the OPTIMISTIC null (arms × 1/16) is wrong by orders of magnitude. Corrected to arms × 1/4, the whole study's 15 passes of 98 go from P = 0.0011 to P = 0.993 and the stop-surface search from P = 4.9 × 10⁻⁵ to P = 0.196. No verdict moves — "nothing was found" becomes MORE true, not less — but the optimistic column in §3.19 and in the set study should be read as unusable rather than as evidence of a discovery. **RE-PRICED 2026-09-22 on the measured answers** (`backtest_jev.ts --replay measured` → `jev.json`, review `reviews/2026-09-22-jev-veto-study.md`; re-run by the main session in a clean worktree at HEAD and reproduced byte for byte, sha256 `0e03c844…`). Three configurations of the live sleeve, primary evaluation (shipped stop, Coinbase-spliced tape), windows A / B / C / D: **(i) the model in shadow — the rulebook — +8.0 / +20.1 / +55.6 / −7.8 %; (ii) the model gating as it runs, mean of 2,000 seeded draws over its coin-flip states, −1.0 / +14.6 / +55.7 / −2.3 % (a loss in 66 % of draws in A and 88 % in D); (iii) the weak-trend clause as code, +0.6 / +14.9 / +56.7 / −3.3 %.** The bar is the set study's: beat (i)'s WORST window in all four evaluations and beat a random veto of the same size there. **Neither (ii) nor (iii) passes**: both lift the sideways year in three evaluations of four, but a veto refusing the same number of entries at random does as well or better on the worst window in 30–43 % of draws for (ii) and 31–33 % for (iii), and on the fourth evaluation (3×ATR trail · Coinbase) both make the bear year the new worst window and lose outright. In the bear year the model's selection is worse than random (null ≥ arm in 93 % of draws), short of the 5 % tail; no cell of 32 reaches 0.05. The high-volatility coin flip layered on (iii) is indistinguishable from refusing the same number of (iii)'s entries at random (P 0.40–0.84). Threshold structure: any `enterMin` in (0.23, 0.55] makes rule ∧ model identical to (iii) cell for cell; (0.55, 0.64] is the coin-flip band where 0.60 sits; above 0.64 every high-volatility entry is refused too. No threshold is recommended. Corrections to the first replay: its veto rate on historical signals, 47.8 %, is **40.0 %** measured; its headline (A −2.5 / D −1.5 %) is **−1.0 / −2.3 %**; its null refused a different number of entries than the arm it judged. The 12 live entry rows recompute through `combineDecision` from their recorded answers. **Recommendation: (i) — `params.jevGate: false` on the live row AND on its paper control `trend-4h`**, because it is the configuration every published number prices, neither alternative clears the bar, and with both rows gating the model's call-to-call noise alone leaves 7–10 % of the live row's entries with no same-bar entry on the control, which defeats what the control is for. **Davies decides**; the go-live draft is rewritten to his choice. **FIXED 2026-09-23 — the question and the threshold, not the model** (review `reviews/2026-09-23-jev-question-fix.md`; migration `0047`). Davies rejected shadow mode ("that retires Jev") and named the cause: configuration. The v1 question listed an "established uptrend" checklist the rulebook does not have, and its 0.60 sat where the model's answers flipped between calls. **v2** (`jevQuestionsV2`) says what the rule already checked, defines the words without saying what to conclude, and asks whether the move looks more likely to continue than to fail, worded for the rule that asks. Measured BEFORE the loop used it (`POST ?action=jev` with `version` and `kind`): all 90 trend-4h entry states × 5 (`backtests/jev_answers_v2.json`), trend-1h's 54 and momentum-1d's 189 (`jev_answers_v2_other.json`), 1,665 calls, $0.059, no missing answer, no echo failure; a same-minute v1 control reproduced the 2026-09-22 answers, so the change is the wording's. The replies are now a graded judgment — rising with strength, falling with volatility, coins within 0.03 of each other — and the only combination the model calls more likely to fail is a **weak trend in high volatility (0.35–0.41)**. **The threshold, 0.45, was chosen from those replies before any backtest**: every state is decided the same way on every call anywhere in (0.41, 0.47], and that band refuses exactly the weak high-volatility states (`JEV_ENTER_MIN`, pinned against the answers file; 0.50, 0.60 and 0.63 fail the pin). **Priced** (`backtest_jev.ts --answers jev_answers_v2.json --enter-min 0.45` → `backtests/jev_v2.json`), primary evaluation, rulebook → rulebook ∧ fixed gate: **A +8.0 → +9.6 %, B +20.1 → +19.5 %, C +55.6 → +58.2 %, D −7.8 → −7.8 %**, refusing 0–9 % of entries (none in D). A and C improve in all four evaluations and B in two; drawdown falls or holds in every cell; the worst window does not move, so by the bar the gate neither passes nor costs anything there, and its A/C gains are inside chance (a random veto of the same size matches them in 6.5–9 % of draws on the shipped stop). The live row and its paper control now decide identically on every bar (0 disagreements; 7–10 % under v1). The other deterministic band, 0.63 (`jev_v2_063.json`), refuses every weak or high-volatility entry (55–63 %): it turns the sideways year from −7.8 to +7.2 %, better than random in ≥ 98.9 % of draws on all four evaluations — the only significant cell in either file — and the bear year from +8.0 to −6.6 %, worse than random; a regime bet, not adopted. Not priced: momentum-1d, whose gate at 0.45 refuses a buy against the 4-hour picture (128 of its 189 states, 7 of them call by call); its paper record is the measurement. **PRICED 2026-09-23 — the two paper rows' gates, and neither clears the bar** (`agents/backtest_jev_other.ts` → `backtests/jev_v2_other.json`, sha256 `e4958cbb…`, identical in two runs and in the main session's re-run; review `reviews/2026-09-23-jev-gates-paper-rows.md`). Priced as trend-4h's was: rulebook against rulebook ∧ gate, windows A–D, four evaluations, the model's five measured replies per state, a random veto of the same size. **trend-1h**: the gate lowers the worst window in all four evaluations (primary +3.8 → +2.9 %; Kraken tape +8.2 → +1.9 %), P(null ≥ gate) 0.88–0.97. **momentum-1d as the loop runs it, once a day**: the bear year falls in all four evaluations, by 4.2–15.1 points (primary −9.0 → −15.8 %). Priced every 4 hours, as the published tables price it, the shipped stop's bear year rises (−8.1 → −6.1 %) but a random veto matches it in 34 % of draws, and under the trail the worst window falls. The gate refuses 63–66 % of momentum-1d's entry signals, every one taken in a 4-hour downtrend, yet does not switch the row off: a refused signal is asked again while momentum stays positive, and the row keeps 53–67 % of its entries and 76–95 % of its time in the market. Its eight bull-window cells with P ≤ 0.05 measure exposure, not selection: the entry-matched null holds the coins 15–18 points less of the time there. **A second finding**: the published momentum-1d numbers decide every 4 hours, and the loop decides once a day; the rulebook alone differs between the two (window D, primary: −7.2 % against +5.8 %). No threshold is recommended: none was chosen before this backtest, and for momentum-1d no threshold in 0.30–0.64 decides every state the same way on every call. **Davies decides** among leaving the gate on (the paper rows then measure the gate at this price), shadow on the two paper rows (`params.jevGate: false`, the model still asked and recorded), or a question written for momentum-1d's own rule — v2 speaks of the 4-hour picture — measured on every state and priced before the loop asks it. He chose the third, for both rows; neither row's own question clears the bar (item 28), so the choice between the first two is his again.

22. **`trend-4h-kraken` earns nothing, and the job it was created for has been done without it (2026-09-22).** The row exists for ONE stated reason — measuring the live rulebook's post-only fills on the second venue — and an independent study took that measurement keylessly in 18 minutes. **It makes no decision of its own**: joined on symbol and bar start, **50 of 50 paired decisions match `trend-4h` exactly, 0 differ**, on `final_action` and on `rule_action` alike, because both rows carry `signal_venue = 'kraken'`, the same rulebook, the same parameters and the same coins. It can differ ONLY through the fill path. **Nothing reads that path**: there is no Kraken equivalent of `probeSummary` anywhere in the tick, the function or the page, and `agent_maker_probes` holds 3 rows, all `revx`, none `kraken` — probes open only on marketable orders and `tick.ts` makes an order marketable only on Revolut X. **The fill path it would measure is a simulation**, not a book: a paper order fills when the execution venue's last closed 1-minute candle traded through the price, with no queue and no post-only rejection. Measured against the real thing — `GET /0/public/Depth` and the trade tape, once a minute for 19 minutes over the live five, 95 coin-minute observations — a resting order at Kraken's touch is reached **79 % of the time within a minute and 91 % within five**, against the loop's candle model's 82 % and 92 %: **the simulation is accurate to 1.01–1.04×**, and it can be re-measured from two public endpoints any afternoon. **What it costs meanwhile**: 3 fills, **$0.1600 of fee against the Revolut X row's $0.0360 — 4.44×**. On the three paired fills Kraken's PRICE was 1.27 bps BETTER (resting at the bid, basis included) and the all-in gap was still **+29.70 bps a side, ≈59.4 bps a round trip, measured live** — the fee is the entire difference, which reproduces the theoretical 62 bps from real fills. **The recommendation is to delete it and add nothing** (Davies' question, and the answer is the one he expected). If a CONTINUOUS Kraken fill record is ever wanted, the right instrument is not a strategy row: `agent_maker_probes` already carries `check (venue in ('revx','kraken'))`, so a Kraken probe records it for no capital, no positions and no return number anyone has to be told not to read. **Two corrections to this reference fall out of the same study.** (a) **§3.19's closing line is true over 27 coins and false over the book.** "The worst Revolut X round trip is TON at 53.8 bps and the best Kraken round trip is BTC at 80.0, so the two schedules do not overlap by 26.2 bps" holds over the coins in `COSTS`; measured over all **245 bases both venues list** (9 snapshots, 2026-09-22 14:16–14:33 UTC; Revolut X UK 307 active USD pairs, Kraken 622 online), the median spread gap is 29.11 bps and the schedules **overlap on 71 coins**, 26 of them with a Kraken book over $100k a day — the worst Revolut X round trip among booked coins is PONKE at **409.0 bps**. The verdict does not move, because the overlap is entirely in the illiquid tail: on the five coins that matter the gap is 1.62–8.93 bps against the 62 bps Kraken needs. But the sentence as written falls over the first time someone measures the whole book. (b) **§3.14's "exactly zero times in 952 cells" is a statement about Revolut X's FEES at Kraken's SPREAD.** Priced against the real Revolut X UK book, Kraken beats it in **28 of 36 cells** on the coins where it is genuinely cheaper — same verdict, different reason, and the distinction matters to §4.16. **And the coins that cheapness buys have no edge.** Eighteen coins chosen by the cost-and-book screen BEFORE any backtest, on Kraken's own three-year tape: with a parameter search, 2 two-window passes against 1.39 by chance; **on seeded parameters, 2 against 3.33 — fewer than chance** (a THREE-test count: the seeded arm left out the plateau; with all four tests it is 1 — KSM — against 2.56, item 23). Six consecutive six-month folds, nothing chosen anywhere: the live five are positive in **39 of 60** folds on Revolut X's costs and 36 of 60 on Kraken's, while the 18 Kraken-advantaged coins manage **49 of 216 (22.7 %)**, best-of-18 being 3 of 6. A free fee schedule moves them 1.8 points and leaves them ~40 points below. **The problem is the coins, not the venue**: Kraken's cost advantage buys access to the part of the market that does not trend. Market making is dead by arithmetic (of 200 Kraken USD pairs clearing $100k a day the median spread is 14.76 bps against the 80 bps a two-sided round trip costs; only 8 are wider, and a spread that wide means nobody else is quoting). The fee tier is **30.4× this row's turnover** away and worth **+0.73 points** if it arrived free, changing 0 of 18 signs. **Falsification, written down**: Kraken's maker fee reaching ≤ 10 bps at this account (its BTC round trip would then be 20.01 bps against Revolut X's 19.87 and the schedules would finally touch — a $10M/30-day tier, not something turnover can buy), or a coin with a Kraken book, no usable Revolut X UK book and three years of tape clearing the four tests on BOTH windows on SEEDED parameters and positive in ≥ 4 of 6 folds. None of the 18 does; 84 more clear the cost-and-book screens and have too little history to test here. **One finding that is not about Kraken at all**: in the same fold test, Revolut X RESTED at 0 % maker beat Revolut X taking the touch, 40 of 60 against 39 of 60, at 1.87–11.91 bps a round trip against 19.87–29.91. That is `0042`'s question, its saving is the same ~18 bps the whole Kraken argument turns on, it is available on the venue already traded, and it is not settled by any backtest that cannot price adverse selection — which is why the probe is the instrument and is already running.

23. **The last Kraken avenue is closed: the 84 coins item 22 could not test (2026-09-22).** An independent study (`backtest_kraken3.ts` → `backtests/kraken3.json`, report `reviews/2026-09-22-kraken-history-study.md`) took the 84 coins that cleared item 22's cost-and-book screen without the history to be tested, from Kraken's quarterly OHLCVT bundle spliced to the keyless OHLC endpoint (the 78 coins in both sources agree on the overlap to 0.0000 bps). It imports `run` rather than copying it and reproduces item 22's 72 seeded cells and 336 fold returns exactly; the main session re-ran it and the JSON reproduced byte for byte. **Only 10 of the 84 have two windows**; 23 have one and 51 none (28 listed after ~2025-08, 8 fail the continuity rule, 6 have under 120 days anywhere, 9 are stablecoins, fiat or wrapped). **One coin, TAO, clears the four tests on both windows on both rulebooks — 1 coin against 0.60 expected by chance (P = 0.46) — and fails the fold test**: positive in 2 of its 4 six-month folds, the latest −13.2 %. TAO is on neither Revolut X book. Across every Kraken-advantaged coin with two windows (item 22's 18 plus these 10), seeded, all four tests: **3 coins pass against 3.26 by chance (P = 0.65), and none of the three clears the fold test.** The pre-cost arithmetic says why: before any fee the shipped rule makes **+22 / −4 bps a round trip** (windows A / B) on these coins, against a Kraken round trip of 97–105 bps; on the live five it makes +112 / +183 bps, of which Kraken's 80 bps would take 44–71 % and Revolut X's ~20 bps takes 11–18 %. Folds: these coins are positive in 48 of 222 (22 %), the live five in 37 of 60 (62 %) on Revolut X. **Correction to item 22**: its "2 against 3.33" was a three-test count; with the plateau restored it is **1 (KSM) against 2.56**, so the sentence stands and is slightly stronger. **Verdict: stop researching Kraken at this fee tier.** What would reopen it, each checkable without an argument: Kraken's maker fee at this account ≤ 10 bps; TAO's three-year tape on 2027-06-25 (reopen only on both windows seeded AND ≥ 4 of 6 folds); KAS's second full window from 2026-12-21; a general re-run in September 2027, when 41 coins will have two windows against 17 today. A Revolut X listing of TAO or KAS is a Revolut X question. **The money**, read from the code: nothing in the running system reads the Kraken balance — candles and the basis are keyless, and every private ORDER call is reached only for a row or order on Kraken, of which `0046` deleted the last. The KEY is still read by the hourly fee-tier call, the venue card's balance line and the probe, all of which answered on an empty account on 2026-09-20 (§6), and deleting it would raise a permanent "Kraken fault" banner. So the recommendation is to **withdraw the balance and keep the account and the key**; reversing it costs a deposit and a ~0.20 % GBP→USD conversion, and no code. It is Davies' move at Kraken — the system cannot withdraw. **Decided (Davies, 2026-09-22):** he withdraws the whole Kraken balance and moves it to Revolut X; the Kraken API key stays in use for candles, the fee tier, the venue card and the probe. After the transfer the read-only probe confirms the Revolut X balance the key sees — the loop's live row is capped by `agent_risk`, not by the balance, so more money there changes no order size.

24. **The third pre-live review: what a live order meets now (2026-09-22).** An adversarial review of the day's agents diff, told above all to list every rule the test doubles do NOT enforce that the real database, venues or model do, produced seventeen items. Sixteen shipped with pins and red counterfactuals, plus a permanent lifecycle test (`agents/lifecycle.test.ts` on the shared doubles in `agents/testing.ts`): one live row from flat through an entry, the floor, the cooldown, a Kraken outage, the kill switch, a demotion and an unreadable fill, twelve stages, through the REAL Revolut X client against a fake venue that answers in the documented vocabulary and refuses what the venue's own client refuses. What a live order now meets:
    - **The kill switch is on the decision.** An unconfirmed live entry is recorded refused and never retried; exits still run (§4.20).
    - **A retry passes every gate a fresh entry does**: the caps, the confirmation, the thin-book guard, and a new lateness guard — no entry more than a quarter of a bar after its bar closed, so a tick outage of over an hour skips that 4-hour bar.
    - **The floor does not wait for the signal venue.** A Kraken outage used to take the floor off every Revolut X position; a warm cache now stands in, and no bar is decided on it.
    - **A reply the client cannot read is never settled**, the too-old cancel included: an unknown state, a fill or price that is not a number, a fee in a third currency. The client reads the documented names (`id`, `status`, `filled_quantity`, `average_fill_price`, `total_fee` + `fee_currency`) first and the names it was written against second; a fee taken in the coin is converted at the fill price.
    - **The floor counts coins the book cannot see yet.** A live buy that cannot be read back, or a `pending` one whose reply was lost, counts as held as far as the venue's balance shows coins beyond the settled live book (all of it when the placement said `filled`). **This rests on one assumption: the Revolut X account the key sees is this loop's alone** (§6: one USD row before any trading). A trade made there by hand would be counted, and could be sold by the floor.
    - **Every live Revolut X sell is capped at what the venue holds**, so a book that over-states the coins can still get out.
    - **Any sell in flight stands the stop down**; a resting buy no longer hides one.
    - **The lease is a compare-and-set checked at every phase and before every live order**; a turn that lost it stops.
    - **Reads are essential or not.** The rows, the open orders and the book are essential: without one the turn stops and says so. The risk row, today's order count, today's P&L, the probes and the observations are not: unreadable, they refuse entries and leave exits alone.
    - **A fill is dated from its first fill, and a marketable order from its own row** (`fillStamp`). Dated from the turn that read it, a buy that settled after the floor had already sold its coins made the book long coins the venue did not hold, and the floor chased them every minute (pinned; red on the old stamp).
    - **The page counts every book** (`otherBooks`), calls a row winding down by the tick's own rule, and opens the day at yesterday's close until today's candle exists (`dayOpenOf`, one function for the page and the loss breaker). The live-unconfirmed banner says entries are refused and exits still run.
    - **Errors keep their names.** PostgREST's `code` and `message` now come before the failing row it quotes (`dbErrorText`), so `ops_errors` keeps the constraint; a turn's errors are all kept in `context.errors`, not only the first 500 characters of them.
    - `stepDecimals("1.5e-8")` read four decimals, which floored every size on that grid to zero; it reads nine.

    Settled while integrating: **`time_in_force`** (§2 — the venue's own client and CLI set it at placement; the LLM reference's line against it is not followed). Left, paper only: a retired row LABELLED live that strands PAPER coins is skipped by the tick. It cannot arise under the new-row go-live design (`0047`), and the page no longer calls it winding down.

    **Audited 2026-09-23 against the review's own reproductions**, pointed at this tree: R1–R9 and D1–D3 no longer reproduce, each failing on the assertion that reproduced it; the lifecycle (every stage, the cross-book cooldown 5e included) and the resolver matrix pass. R10 passes once its fake venue reports the coins it holds: the tick now caps a live sell at the venue's balance, and that fake's balance was always empty, which the real venue never is while holding a position (an unreadable balance still leaves the sell uncapped, so the stop is never lost to it). D4 compared `dayPnl` on two different inputs, not the page; the page's day open is `dayOpensFrom` → the tick's own `dayOpenOf`, pinned on both sides. The one rule the review found written down and not enforced — a paged read ends its order with the unique `id` — is now checked in `assertPagedOrder`, which the client and every double call; pinned, red on the old guard. B4 itself (the settlement field names) is still confirmed only by the first live order's read-back; until then the client reads the documented names, refuses what it cannot read, and the floor counts the coins the venue shows.

25. **What is kept, and for how long (measured 2026-09-23).** The pre-live review's last doc gap: retention was written down for three tables and no others. Pruned daily by `0037`'s `agents-prune-daily` job: `agent_basis` and `agent_observations` after 30 days, `agent_candles` after 200 days (1-minute candles after 3). **Kept in full, on purpose: `agent_decisions`, `agent_orders` (which carry the fills) and `agent_maker_probes`.** They are the record the book and every P&L figure are computed from (item 7), and a position opened a year ago still needs the order that opened it. With the three rows running today that is ≈ 100 decisions a day (66 from `trend-1h`, 30 from `trend-4h`, 3 from `momentum-1d`, 2026-09-22/23) at ≈ 1.8 kB each, and ≈ 3 orders a day: about 70 MB a year, against a database of 98 MB today. Every read that grows with them is paged (§4.17, B3). Look again when the database passes about 300 MB; the first thing to go then is the state and answers JSON of old HOLD decisions, never an order, a fill, or a decision that entered or exited.

26. **An entry is one slot of its row, and nothing else caps it (2026-09-23).** Until today `tick.ts` sized an entry at `min(capital_usd / slots, agent_risk.max_order_usd)` and `riskGate` refused any entry over `max_order_usd` ($20), so every slot was $20 at most whatever a row's capital said: dropping SUI and keeping $100 on four coins could not give $25 slots, and adding capital to a row that earned it would not have made its orders bigger. Davies removed the cap ("单笔上限删了吧，之后测试表现好的话我还会再加资金的"). An entry is now `slotUsdOf(row)` — capital over the positions the row can hold at once (its symbols, or the rotation's `topN`) — and the gate's per-order limit is that slot times `ORDER_SLOT_TOLERANCE` (1.1), per row: a guard against a sizing bug, with room for a re-quote's drift. That room fixes a latent refusal too: with the limit equal to the slot, a full-slot resting buy re-quoted after the touch rose even a few cents was refused (pinned: $20.10 on a $20 slot). **Nothing in production changed size**: `trend-4h` is $100 over five coins ($20), `momentum-1d` and `trend-1h` $40 over three ($13.33 each), all at or under the old $20. Pins: an entry is capital ÷ slots (four $25 orders on a $100 four-coin row; the old sizing places four $20 ones), and an entry over 1.1× its slot is refused (a retry recorded at $60 on a row cut to $30) while one inside it is placed ($32) — red with the tolerance at 1.0, and red with no limit at all. The column itself is dropped by migration `0048`, pushed once this tick had deployed (both readers select `*`, so the order is a courtesy, not a hazard). The exposure cap (`max_exposure_usd`, marked to market) and the daily loss limit stay the account-level limits.

27. **VENUES shows Binance, not Kraken (2026-09-23).** Davies: Kraken off the page's VENUES, Binance on, a Binance theme colour, and the PAPER badge in a colour Binance's cannot be mistaken for. Kraken stays what it has been since `0046`, the signal venue whose public candles every rule reads; it is simply not an account on the page. Binance's card is the account read-only (`binanceCard` → `binanceAccount`: one signed `GET /api/v3/account`, cached a minute per isolate, cut off at 4 s), and a failure is the card's note and a fault banner, never a broken page. Binance answers 451 to US addresses (§6), and an Edge Function runs in the region nearest its caller, so the page's dashboard call names London (`forceFunctionRegion=eu-west-2` — a query parameter, because the function's CORS does not allow the `x-region` header). The colours were measured, not picked (`dataviz`'s validator, all pairs, on the page's background): PAPER's old gold sat ΔE 7.1 from Binance's yellow under normal vision, below the 15 floor; the freed Kraken lavender sat ΔE 1.0 from Revolut X's blue for a deuteranope; teal, cyan, violet, orange and slate each fell within 15 of the venues' blue and yellow or of the gain and loss colours; pink passed and Davies did not want it. PAPER is therefore neutral (#e8e4da, ΔE ≥ 16 from every hue on the page) and dashed, which also says "not money" without colour. The price chart takes the row's own venue colour, since the lavender it wore was Kraken's. A stablecoin now reads as money on a card (`50.00 USDT`, not `50.0000`). Pins: the account's shaping and its one signed read, the card's no-key, cache and refusal paths, the page's venue order, and five browser checks per breakpoint (VENUES is Revolut X then Binance with no Kraken, Binance's yellow and PAPER's dashed neutral read back from computed style, the Binance card's balances, a 451 as a labelled Binance fault) — all ten red on the previous bundle.

28. **Each paper row's own entry question: written, measured, priced — neither clears the bar (2026-09-23).** Davies chose (c) for the two paper rows whose v2 gate fails the bar (item 21), adding that every strategy's Jev may have its own design. One wording per row, each written for its rulebook — what it checked, how long it holds (momentum-1d: a median of about three days, sometimes weeks; trend-1h: hours to a few days) and what each word measures for it (for trend-1h every word named `_4h` is a 1-hour measure, which v2 never said) — was frozen in `reviews/2026-09-23-jev-row-questions-prereg.md` before the model saw it, together with the rule that picks each threshold from the measured replies alone (the midpoint of the widest band where every state is decided the same way on every call) and the bar (item 21's, unchanged). The wordings are `agents/jev_rows.ts` (`v3-momentum-1d`, `v3-trend-1h`). Measured (`backtests/jev_answers_rows.json`, 1,215 calls) and priced (`backtest_jev_rows.ts` → `backtests/jev_rows.json`; review `reviews/2026-09-23-jev-row-questions-study.md`): **trend-1h's wording decides every state exactly as v2 does** (at 0.47 it vetoes the same six weak-trend high-volatility states), so all 1,843 of its priced cells equal v2's and it fails the same way. **momentum-1d's replies still follow the 4-hour words** (94 % of downtrend replies under 0.45, v2's 93 %) and overlap everywhere below 0.66, so the rule's threshold is 0.77, which refuses 183 of 189 states: once a day the row keeps 2–7 of the rulebook's 30–55 entries a window, removing the bear year's loss (A −9.0 → −0.1 %) and most of the bull years' gains (C +104.4 → +7.1 %). It never lowers the worst window, beats a same-size random veto under the shipped stop (P 0.050, 0.039) and loses to it under the trail (P 0.968, 0.959); the bar asks for all four evaluations, so it fails. The shipped-only reading (§3.17's) would pass it at the line; it was reported, not pre-registered as the decision, and is not taken as a pass. Before pricing, the script reproduced `jev_v2_other.json` from the v2 replies at 0.45, 8,101 cells with 0 differences, and its check failed on a counterfactual threshold. **Nothing changes in production**: both rows keep v2 at 0.45, no `params.jevQuestion` is set, and keeping that gate or shadowing the two rows (`params.jevGate: false`) is Davies' call.

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


### Binance and Deribit keys (2026-09-23)

One run of `GET /functions/v1/agents?action=probe&only=binance,deribit`, fired the same way at 02:24 UTC from the
project's region (eu-west-2, London). Read-only: neither client has a call that trades, and the report carries no
key, token or amount.

| Check | Result |
|---|---|
| Binance reachability | `api.binance.com` 200 from eu-west-2 (clock skew −109 ms). From this repository's development container it answers 451 "restricted location", so the key is usable only from the server |
| Binance account | `SPOT`; the account's own flags `canTrade` / `canDeposit` / `canWithdraw` true (the key's are the next row); no asset held (unfunded); commission 0.10 % maker and 0.10 % taker at this tier (AVAXUSDT `tradeFee` agrees) |
| Binance key permissions (`apiRestrictions`) | reading ✓, **spot trading ✓**, withdrawals ✗, futures ✗, margin ✗, options ✗, internal transfer ✗, universal transfer ✓, **no IP restriction**; created 2026-09-23 00:31 UTC |
| Binance symbol rules | BTC / ETH / SOL / AVAX / SUI against USDT all `TRADING`; minimum notional $5; steps 1e-5 / 1e-4 / 1e-3 / 1e-2 / 0.1; `LIMIT_MAKER` (post-only) and exchange-held `STOP_LOSS_LIMIT` available |
| Deribit reachability and auth | 200; client-credentials auth accepted, token for 899 s; scope includes `trade:read_write`, `account:read_write`, `block_trade:read_write`, `wallet:read` (no withdrawal) |
| Deribit account | BTC summary readable (40 fields), not funded — and Davies cannot fund it from the UK |
| Deribit DVOL | daily, 11 bars back; the 2026-09-23 bar (still forming at 02:24) at BTC 37.69, ETH 51.30 |

Two settings worth changing at the venues, both Davies': neither key needs to trade today, so Binance's
"Enable Spot & Margin Trading" and "universal transfer" and Deribit's `trade:read_write` can be switched off until a
use is decided, and Binance cannot be IP-restricted from Supabase (its Edge egress has no fixed address).

## Sources

- TypeSafe: https://docs.typesafe.ai/models · https://docs.typesafe.ai/api · https://docs.typesafe.ai/confidence · https://docs.typesafe.ai/concepts/state · https://docs.typesafe.ai/model-jaggedness/jev-1.13 · https://typesafe.ai/blog/introducing-system-one-models-and-jev · https://docs.typesafe.ai/llms.txt
- OpenRouter: https://openrouter.ai/typesafe/jev-1.13 · https://openrouter.ai/labs/jev · https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints · https://openrouter.ai/docs/client-sdks/go/sdks/decisions/README
- Integrations: https://github.com/prismhq/jev-router · https://github.com/typesafe-ai/typesafe-sdk-js · https://pydantic.dev/docs/ai/models/typesafe/ · https://docs.litellm.ai/docs/pass_through/typesafe · https://github.com/samchon/typia/issues/2409 · https://github.com/can1357/oh-my-pi/issues/12458 · https://github.com/vinaychawla-ops/jev-openrouter-example
- Revolut X: https://developer.revolut.com/docs/x-api/revolut-x-crypto-exchange-rest-api · https://developer.revolut.com/docs/x-api/authentication · https://developer.revolut.com/docs/x-api/place-order · https://developer.revolut.com/docs/x-api/get-candles · https://developer.revolut.com/docs/x-api/get-all-balances · https://github.com/revolut-engineering/revolut-x-api (incl. `revolut-x-api-for-llm.md`) · https://www.revolut.com/legal/crypto-exchange-fees/ · https://help.revolut.com/en-FR/help/wealth/cryptocurrencies/crypto-exchange/api-trading/question-what-api-does-revolut-x-provide/
- Kraken: https://docs.kraken.com/api/docs/guides/spot-rest-intro/ · https://docs.kraken.com/api/docs/guides/spot-rest-auth/ · https://docs.kraken.com/api/docs/rest-api/add-order/ · https://docs.kraken.com/api/docs/rest-api/get-orders-info/ · https://docs.kraken.com/api/docs/rest-api/get-trade-volume/ · https://docs.kraken.com/api/docs/rest-api/get-extended-balance/ · https://docs.kraken.com/api/docs/rest-api/get-ohlc-data/ · https://docs.kraken.com/api/docs/rest-api/get-recent-trades/ · https://docs.kraken.com/api/docs/guides/spot-ratelimits/ · https://docs.kraken.com/api/docs/guides/spot-rest-ratelimits/ · https://www.kraken.com/features/fee-schedule · https://support.kraken.com/hc/en-us/articles/360000919966-How-to-create-an-API-key · https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data
