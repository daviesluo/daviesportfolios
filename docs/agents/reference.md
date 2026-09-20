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
| Trading limits | **10 orders/s, 1,000 orders/day** per key | docs |
| Other limits | authenticated 1,000 req/min; public ~20 req/10 s; public candles ≈ 1 req/s | docs; measured |
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

## 4. Design consequences (decided by the evidence above)

1. **Jev is a decision node, not a strategist.** Code computes indicators, regime, position and risk; Jev sees ≤ 1–2 k tokens of categorical state and answers typed questions; a deterministic risk layer has the last word. Anything else contradicts the vendor's own jaggedness page.
2. **Cadence is minutes-to-hours, not seconds.** Signals on closed 1h/4h bars; the loop wakes every 5 minutes (the existing `snapshot-record` cadence) to manage resting orders and stops; a trade decision at most a few times a day. "Every second" would cost nothing on Jev and everything on fees and the 1,000-order cap.
3. **Limit orders by default, `post_only`**, taker only for stop-loss exits where certainty of fill matters more than 9 bps.
4. **BTC, ETH, SOL only** — the only pairs on this venue with ≤ 3 bps spreads and real volume. Everything else costs 3–8× more per round trip.
5. **Paper first.** Every strategy runs in shadow mode against live prices, recording the orders it *would* have placed, until its paper record is shown; the switch to live is a per-strategy flag Davies flips, and the first live order requires his explicit confirmation.
6. **Hard, code-enforced caps** the model cannot touch: max notional per order, max open exposure, daily loss limit (kill switch), max orders per day well under 1,000, and a global pause flag in the database.
7. **Record inputs, not conclusions** (the `snapshot-record` lesson): every Jev call's state, questions and answers, and every order's request/response, are stored; P&L is computed in one place from fills and marks.

## 5. Open questions that block the build (for Davies)

1. **The Ed25519 private key.** Revolut X signs every authenticated request with the private half of the key pair generated at key creation. `Revolut_X_API_kEY` alone (the 64-char id) cannot sign anything. Was the private key (the `private.pem` from `openssl genpkey`) also stored as a Supabase secret? Under what name?
2. **The sub-account.** Revolut X's API binds a key to the whole user account; the docs describe no sub-account scoping. Is the "$100 sub-account" a separate Revolut X login (then its key sees only that account — ideal), or a sub-portfolio inside the main account (then the key can see and trade the main account's balances too, and the isolation has to be enforced by our own caps)?
3. **Key permission** — created as full trading, with the IP allowlist off (Supabase Edge egress IPs are not fixed)?
4. Confirm **paper-trading first**, live only after his explicit go per strategy.

## Sources

- TypeSafe: https://docs.typesafe.ai/models · https://docs.typesafe.ai/api · https://docs.typesafe.ai/confidence · https://docs.typesafe.ai/concepts/state · https://docs.typesafe.ai/model-jaggedness/jev-1.13 · https://typesafe.ai/blog/introducing-system-one-models-and-jev · https://docs.typesafe.ai/llms.txt
- OpenRouter: https://openrouter.ai/typesafe/jev-1.13 · https://openrouter.ai/labs/jev · https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints · https://openrouter.ai/docs/client-sdks/go/sdks/decisions/README
- Integrations: https://github.com/prismhq/jev-router · https://github.com/typesafe-ai/typesafe-sdk-js · https://pydantic.dev/docs/ai/models/typesafe/ · https://docs.litellm.ai/docs/pass_through/typesafe · https://github.com/samchon/typia/issues/2409 · https://github.com/can1357/oh-my-pi/issues/12458 · https://github.com/vinaychawla-ops/jev-openrouter-example
- Revolut X: https://developer.revolut.com/docs/x-api/revolut-x-crypto-exchange-rest-api · https://developer.revolut.com/docs/x-api/authentication · https://developer.revolut.com/docs/x-api/place-order · https://developer.revolut.com/docs/x-api/get-candles · https://developer.revolut.com/docs/x-api/get-all-balances · https://github.com/revolut-engineering/revolut-x-api (incl. `revolut-x-api-for-llm.md`) · https://www.revolut.com/legal/crypto-exchange-fees/ · https://help.revolut.com/en-FR/help/wealth/cryptocurrencies/crypto-exchange/api-trading/question-what-api-does-revolut-x-provide/
