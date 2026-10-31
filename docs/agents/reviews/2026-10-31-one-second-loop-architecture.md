# A one-second market-making loop on Revolut X: the architecture (2026-10-31)

Davies, 2026-10-31: "出 XRP/GBP 每秒报价的架构方案" (an architecture for quoting XRP/GBP every second). The strategy is
CRYPTOBOOKS' method (a) (`reviews/2026-10-31-crypto-books-deep.md` §4.1, §7; `backtests/cryptobooks/`): a 0 % maker
12 bps either side of Binance's second price, converted to pounds, on Revolut X's UK XRP-GBP book, re-priced when fair moves
about 10 bps, selling only what it bought, inventory-capped. Another agent is refining the rule itself; this document is
built for what the brief gives: a decision every second, a few order actions a minute normally, bursts on volatility,
fewer than 1,000 orders a day per Revolut X account, more sub-accounts of Davies' own if needed.

**Design only.** Nothing was built, deployed or changed: no code, no migration, nothing in Cloudflare, no order. The facts
below come from primary documentation (cited in §10), read-only SQL against production, and keyless public reads from
this container. No balance of Davies' accounts appears anywhere in this document.

## 0. The answer

**Recommendation: paper runs inside Supabase. Live runs as a Cloudflare Durable Object, watched by a second one.**

1. **Paper (now, nothing new to buy):** the §7 pre-registration as drafted. It is a call a minute in Supabase (a row of
   `edge_calls`, under the watchdog) that steps the replay through the closed minute, second by second, from Binance's
   one-second klines and Revolut X's public prints. It needs no one-second clock, so it does not wait for this decision.
2. **Live (on Davies' word, after the paper verdict), design (C):** a new Worker, `daviesportfolios-mm`. In it, a Durable
   Object `MmLoop` (one per sub-account and book, location hint `weur`) holds Binance's public bookTicker WebSocket
   (`data-stream.binance.vision`), decides on every message and at least once a second (a one-second alarm), and orders on
   the private Revolut X API alone. Re-prices go through the venue's **replace** endpoint, which "does not count towards
   the daily limit". It writes each order to its own SQLite journal before the call. Supabase stays the system of record:
   a narrow `mm` Edge Function takes every order, fill and minute, idempotent by client id, from an outbox. A second
   object, `MmGuard`, lives in the monitor Worker. On its own two-second alarm it reads the loop's heartbeat and cancels
   every resting order on the sub-account when the loop has been silent for 5 s.
3. **Why not Supabase at one second.** The project's one-minute job has a structural problem here: pg_net 0.20 runs a batch
   until every request has answered. A one-second job's call would wait behind the minute's slowest call (up to 55 s), and
   `src/cron_jobs.test.js` refuses a second job that calls pg_net. Separately, in the last 24 hours 2,337 calls against
   29,723 beats (7.9 %) had written no beat 13 s into their minute and were run again by the watchdog. A maker quote left 12 bps from fair while its loop
   is down is exactly what CRYPTOBOOKS priced at the minute: +£0.65 a day and 113 arbitrage fills, against +£6.10. The
   seconds-level safety clock has to be outside Supabase, so it is in Cloudflare either way. Once it is, the loop belongs
   beside it.
4. **Fallback, if Davies keeps the key out of Cloudflare, design (A′):** one call a minute of a dedicated `mm` Edge Function
   answers at once and loops every second in `EdgeRuntime.waitUntil` for up to 170 s, handing over by lease, so one failed
   minute leaves no gap. The guard is then a Workers-Free Durable Object that calls `mm?action=cancelall` in Supabase,
   where the key stays. It costs nothing new. It is weaker in a database or runtime stall, and its CPU budget (2 s per
   request) has not been measured for this workload.
5. **What it costs:** (C) needs Workers Paid. That is $5 a month minimum, about $6–9 with this load (§3). Workers Free
   cannot host it: the loop's alarms alone are 86,400 of the 100,000 Durable Object requests a day the account gets, and
   the monitor already uses about 2,900.

**Davies decides (§8):** Workers Paid; where the new key lives (Cloudflare alone, recommended; or Supabase alone, which
means A′); a new sub-account for this alone; the fail-closed time when Supabase cannot be reached; a phone kill switch
through a GitHub Action.

## 1. What the loop must do, in numbers

| need | value | source |
|---|---|---|
| decide | every second, and on every Binance move ≥ θ = 10 bps | brief; CRYPTOBOOKS §4.1 (d 12, θ 10, κ 0.5) |
| fair | Binance XRPUSDT last price × Coinbase USDT-USD (minute) ÷ GBP/USD (TrueFX recorder) × exp(trailing 3 h centre of the book's own prints) | CRYPTOBOOKS §7.2 |
| only the first factor is fast | the other three change at most once a minute; Supabase computes them already (`fx_ticks`, the cb_fx fallbacks, the recorded tape) | §7.2 |
| order actions | replay: 800.7 orders and 75.8 fills a day on XRP-GBP at θ = 10 | CRYPTOBOOKS §4 table |
| bursts | on a fast move, up to one re-price per side per second, more on a gap | brief |
| venue limits, per sub-account | place 10/s, and 1,000/day "does not apply to sub-accounts"; **replace** 10/s, "does not count towards the daily limit"; cancel and other authenticated calls 100/s and 1,000/min; at most 300 active orders an account, 1,000 across all | developer.revolut.com, read 2026-10-31 (§10) |
| venue public endpoints | about 1 token a second **per address**: the loop never uses them | reference §2 |
| Binance public | REST weight 6,000 a minute per IP (`exchangeInfo.rateLimits`, measured 2026-10-31); the WebSocket stream costs no weight | §10 |

What this means for the budget. A re-price is a `PUT /1.0/orders/{id}`, not a cancel plus a POST. POSTs are then needed only
after a fill (about 76 a day) or a pull (a burst, a guard). A dedicated sub-account is, by the venue's own page, outside
the 1,000-a-day bucket. Neither statement has been tested on the live venue. Until they are, the design keeps
quotes_live's own governor (900/950 POSTs a UTC day), adds a replace cap (5,000 a day, then quoting stops), and spaces all
order calls at least 125 ms apart (`QUOTE_LIVE_POST_GAP_MS`, 8 a second).

The steady request rate per sub-account: one `GET /1.0/orders/active` a second (60 a minute of the 1,000), a few PUTs a
minute, about 76 POSTs and 76 fill reads a day. That is about 87,500 authenticated calls a day, roughly 61 a minute.

## 2. The candidates

**(A) pg_cron every second → pg_net → an Edge Function.** pg_cron 1.6.4 schedules "1 seconds". The calls would leave by
pg_net, though, and pg_net 0.20 reads its queue again only when the batch in flight has answered: the minute job's batch
runs up to 55 s (`books` ~44 s; every row under 60 s since `0099`). A one-second call queued at :01 can therefore leave at
:45. That is a design break here, not a tuning problem (docs/agents/CLAUDE.md, "Every recurring Edge call is a row of ONE
cron job"). There is also the start-failure rate: in the 24 hours to about 09:20 UTC today `edge-watchdog` re-ran 2,337 calls
that had written no beat 13 s into their minute (against 29,723 beats, 7.9 %), and 29 failed after the re-run. At one call a second that would be about 6,800 missed seconds a day, each needing
a fresh isolate and a database read of the state. Cost: +2.59 M invocations a month (+$4 at the Pro overage of $2 per
million, in whole packages) and 86,400 `cron.job_run_details` rows a day (~133 MB, the SPEED study).

**(A′) One Edge call a minute that loops every second inside it.** The SPEED study (`backtests/speed/results/
architectures.json`) measured a one-second keyless poll at 98.5 ms of CPU a minute (4.9 % of the 2 s per-request limit),
55–58 s of wall time, and 43,200 more invocations a month ($0). Done properly for a maker:

- Its own function (`mm`), so it never shares an isolate with `agents`' 44-second calls. On 2026-10-26 the platform served
  several `agents` calls from one worker.
- It answers pg_net at once and runs the loop in `EdgeRuntime.waitUntil`, so it never holds the minute's batch. Pro's wall
  limit is 400 s.
- It runs up to 170 s, and each minute's call takes over by lease. A minute whose call starts late (today the quotes calls'
  beats came p50 0.70 s, p90 6.09 s, p99 13.5 s after the minute) or never starts leaves no gap.
- The unknown: its CPU is one request's 2 s for the whole 170 s. Signing, the active-orders read and the decision need a
  measured budget first (§9). Polling Binance REST from Supabase's shared egress spends a per-IP weight that other tenants
  share as well.

**(B) A Durable Object on a one-second alarm, polling.** Alarms are "guaranteed at-least-once" and retried with "exponential
backoff starting at a 2 second delay … up to 6 retries"; one alarm per object; the handler has 15 minutes of wall time; CPU
30 s per request by default. An alarm is a billed request and each `setAlarm()` a row written. The object stays in memory
while it has pending I/O or an outbound WebSocket, and is evicted after 70–140 s idle. It restarts on a deploy, on a
runtime update or when it is moved, "no guarantees about restart timing", and there are no shutdown hooks. Its location is
fixed at creation, near the first caller or a best-effort hint. Secrets are per-Worker encrypted bindings, "not visible
within Wrangler or Cloudflare dashboard after you define them". Ed25519 `sign` and `importKey` are in Workers' Web Crypto.

**(C) (B) plus Binance's WebSocket.** `wss://data-stream.binance.vision/ws/xrpusdt@bookTicker` is the market-data-only
stream. It answered 101 from this container, and the US address that `api.binance.com` refuses with 451 was not refused
here. On a quiet Saturday (09:10 UTC) it carried 94 bookTicker and 36 trade messages in 20 s. Trade-message lag from this
container was p50 53 ms, p90 54 ms (41 messages; clock skew not removed). The object decides on each message whose fair
has moved ≥ θ, and its one-second alarm both decides on the current fair and keeps it alive. Revolut X documents no
WebSocket (its REST page, read whole, names none), so fills come from the one-second active-orders read.

**(D) An always-on process on a small London VM** (AWS Lightsail or Fly.io `lhr`, about $5 a month). It is the only option
with a **fixed egress address**, so the only one where the Revolut X key's IP allowlist could be switched on. Today every
key of ours leaves it blank because Supabase's egress has no fixed address (reference §5.3). Against that: a new provider
and bill, an OS to patch, a supervisor, a key on a disk, no deploy pipeline in this repository, and one machine with no
independent clock. Its guard would still be a Cloudflare object. It is worth it only if an IP-allowlisted key is the thing
Davies wants most.

(Ruled out before the table: Supabase Realtime and Postgres `LISTEN` give no clock and no egress; Davies' own computer is
not a production host.)

## 3. The comparison

| | (A) pg_cron 1 s → Edge | (A′) minute-launched Edge loop | (B) DO alarm, REST poll | **(C) DO, Binance WS + 1 s alarm** | (D) London VM |
|---|---|---|---|---|---|
| reaction to a Binance move (p50 / p90) | 0–1 s grid + pg_net dispatch 0.19 s / ~2 s, **+ up to 55 s behind the minute batch** | 0–1 s grid + read ~0.1 + order 0.08 ≈ 0.7 / 1.1 s | 0–1 s grid + read + order ≈ 0.6 / 1.0 s | stream ~0.05 + decide + order ≈ 0.15–0.25 s (est.) | ≈ 0.1–0.2 s (est.) |
| order call, measured | from the pending row to the venue's `created_date`: **p50 82 ms, p90 110 ms, p99 178 ms** (1,288 of LIVE's orders, 3 days, eu-west-2) | same | unmeasured from `weur` (Revolut X sits behind Google's load balancer, `via: 1.1 google`) | same as B | unmeasured |
| what stops it | pg_net batching (design break); 7.9 % watchdog re-runs; DB stalls (10-02: 2 of 81 minutes ran) | minute job not firing for > 2 min; DB stall; CPU 2 s/request; shared-runtime incidents | DO restart on deploy or runtime update (seconds); Cloudflare incident | same as B, plus WS drops (reconnect; the alarm decides meanwhile) | host down; process crash |
| seconds-level dead-man | needs Cloudflare | needs Cloudflare (Free plan is enough: §3.1) | second DO | second DO | needs Cloudflare |
| cost a month, new | ~$4 Edge + 133 MB/day of cron log | $0 (+$0 guard on Free) | $5 min, ~$6–9 | $5 min, ~$6–9 | ~$5 + the guard's |
| where the key lives | Supabase (as today) | Supabase (as today) | Cloudflare Worker secret | Cloudflare Worker secret | the VM |
| IP allowlist on the key | no | no | no | no | **yes** |
| state | DB every second | memory + DB per action | DO SQLite + Supabase mirror | DO SQLite + Supabase mirror | local DB + mirror |
| deploys by | edge-functions.yml | edge-functions.yml | new `mm-deploy.yml` (wrangler) | new `mm-deploy.yml` | none exists |
| code shared with paper | the pure core | the pure core | the pure core | the pure core | the pure core |
| verdict | **no** | fallback | no: C at the same price | **recommended** | only for an IP-locked key |

### 3.1 Cloudflare's bill, worked

Durable Objects, Workers Paid: 1 M requests a month included, then $0.15 per million; 400,000 GB-s included, then $12.50
per million, billed on 128 MB per object for wall-clock time; SQLite rows written, 50 M included. Workers Paid: $5 minimum,
10 M requests and 30 M CPU-ms included.

| item | a month (30 d) | billed |
|---|---|---|
| loop alarms, 1 s | 2.592 M requests | |
| guard alarms, 2 s | 1.296 M | |
| guard → loop heartbeat reads | 1.296 M | |
| WS messages, if a client socket's incoming messages bill like an accepted socket's (20:1; not stated for outbound) | ≤ 2.6 M at 20 messages a second | |
| monitor's existing DO use | ~0.09 M | |
| **requests** | ≤ 7.9 M | (7.9 − 1) × $0.15 ≤ **$1.04** |
| duration, both objects awake all month | 2 × 2.592 M s × 0.125 GB = 648,000 GB-s | (648,000 − 400,000) × $12.50 / 1 M = **$3.10** worst case; $0 if only the loop counts |
| rows written (each `setAlarm` is one; the journal ~2,000 a day) | ~4 M | within 50 M: $0 |
| CPU, at ~3 ms a second (est.) | ~8 M CPU-ms | within 30 M: $0 |
| **total** | | **$5 minimum; $6–9 expected** |

On Workers Free (100,000 DO requests and 100,000 rows written a day, 13,000 GB-s a day) the loop's 86,400 alarms alone
leave 10,700 requests for everything else. A guard alone does fit (43,200 alarms and rows a day, plus the monitor's
~2,900), which is why A′ costs nothing.

Supabase Pro (2 M invocations a month included): today's minute job makes about 29,700 calls a day (0.89 M a month).
(C) adds the `mm` function's calls: a config pull every 5 s (0.52 M a month), the outbox (about 3,000 a day) and three
minute rows. That totals about 1.5–1.6 M a month, still inside the quota.

## 4. The recommended design (C)

```
                     Binance (public)                                Revolut X (UK, private API, sub-account "mm")
        wss://data-stream.binance.vision  ─┐                    ┌──  POST /orders · PUT /orders/{id} · DELETE /orders[/{id}]
        (fallback REST data-api…/bookTicker)│                   │    GET /orders/active (1/s) · GET /orders/{id} · fills
                                            ▼                   │
 ┌──────────────── Cloudflare: Worker "daviesportfolios-mm" (Workers Paid) ───────────────────────────────┐
 │  MmLoop DO  (one per sub-account × book; locationHint weur)                                             │
 │   ├─ WS client → fast fair  (stale > 2 s → pull quotes)                                                 │
 │   ├─ 1 s alarm → decide(state, inputs, now)  ── the pure core, shared with paper ──┐                    │
 │   ├─ SQLite: journal (pending row BEFORE each call), inventory, governor counters, │ outbox              │
 │   ├─ order client (revx.ts + replace), 125 ms spacing, 429 Retry-After             ▼                    │
 │   └─ GET /beat  ←──────────────────────────────── heartbeat read every 2 s ──┐   POST mm?action=ingest   │
 └──────────────────────────────────────────────────────────────────────────────│───────────│──────────────┘
                                                                                │           │ (MM_SECRET)
 ┌──────────────── Cloudflare: Worker "daviesportfolios-monitor" (exists) ──────│───┐       │
 │  MmGuard DO (locationHint eeur; 2 s alarm)  — loop silent 5 s → DELETE /orders (cancel all), read back,     │
 │                                               report; never places                       │       │
 │  minute cron (exists) — new check "mm": Supabase health + the guard's memory → ops_errors / GitHub issue    │
 └──────────────────────────────────────────────────────────────────────────────────┘       │
                                                                                            ▼
 ┌──────────────── Supabase (eu-west-2) ───────────────────────────────────────────────────────────────────┐
 │  Edge "mm": ?action=config (armed_at, dry_run, global_pause, limits)  ← pulled by MmLoop every 5 s        │
 │             ?action=inputs  (USDT-USD, GBP/USD, 3 h centre → slow multiplier) ← edge_calls row, 1/min     │
 │             ?action=ingest  (orders, fills, minutes, events; upsert by client_order_id / fill id)        │
 │             ?action=paper   (§7 replay of the closed minute; also fills the dry-run's would-be quotes)   │
 │             ?action=markouts (1/5/30/300 s after each fill)                                              │
 │  tables agent_mm_*  ·  monitor/health.ts reads agent_mm_state freshness  ·  ops_errors  ·  Agents page    │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        GitHub: mm-deploy.yml (wrangler, pinned) · mm-kill.yml (workflow_dispatch → Worker /kill, MM_SECRET)
```

### 4.1 One decision

Each turn runs on the alarm, or on a WebSocket message that moves fair ≥ θ, never two at once (one object, one thread).

1. **Inputs.** Fast fair = Binance mid (bookTicker) × the slow multiplier. The multiplier is USDT-USD ÷ GBP/USD ×
   exp(centre), pulled from `mm?action=config` with its `computed_at`. No new risk is taken when Binance's last message is
   more than 2 s old, or the multiplier more than 10 minutes old (PR5's FX rule).
2. **Reconcile.** Read `GET /orders/active` (one call). An order the journal holds that is no longer active is read with
   `GET /orders/{id}` and its fills booked (whole base steps; the coin fee net, quotes_live's D11/D12). A journal row still
   `pending` past its grace is matched by client id in the active list, then the history. One the venue shows nowhere stays
   pending for a person, never marked rejected (the go-live audit's D3).
3. **Decide** (the pure core): the target bid at fair·(1 − d) while inventory is under the cap and the day's loss stop has
   not fired; the target ask at fair·(1 + d) for what it holds, never more ("sells only what it bought"), never under its
   cost by more than the rule allows. Re-price a resting quote only when fair has moved ≥ θ since it was priced, at most
   once per side per second. A move of ≥ 30 bps within 2 s pulls the bid and re-quotes after 5 s calm (the burst guard;
   numbers for the strategy agent to set).
4. **Act.** Each action is written to SQLite as `pending` with a fresh UUID client id before the call: place (POST,
   post-only, gtc), replace (PUT with a new client id and an explicit `post_only`, because the page does not say it is
   inherited), cancel (DELETE). A 429 waits its `Retry-After` and goes once more with the same client id. A 5xx or lost
   reply stays pending for the next reconcile.
5. **Record.** Append the journal rows and fills to the outbox. Flush it to `mm?action=ingest` asynchronously (batched,
   at most once a second, a minute row every minute), never in the order path. A database stall delays the mirror, not the
   trading.

### 4.2 Safety, layer by layer

| layer | what | where | latency |
|---|---|---|---|
| post-only | never a taker; a crossing re-price is refused by the venue as `rejected`, recorded | venue | 0 |
| inventory cap | no bid while inventory ≥ cap (the replay's mean £67, max £616 at £600; the cap is a setting) | core | 0 |
| governor | POST 900 → no new bids, 950 → nothing but cancels; PUT 5,000 → stop; spacing 125 ms; ≤ 300 active never near (2–4 used) | core | 0 |
| daily loss stop | realised today + marked ≤ −1 % of capital → no bids for the UTC day, asks stay | core | 0 |
| stale inputs | Binance > 2 s, multiplier > 10 min → pull the bid; asks stay at their price | core | ≤ 2 s |
| burst | ≥ 30 bps in 2 s → pull, wait 5 s calm | core | ≤ 1 s |
| kill switch | `agent_mm_config.armed_at` null → cancel bids, place none; asks (selling held coin) stay | Supabase, pulled every 5 s | ≤ 5 s |
| global pause | `agent_risk.global_pause` → cancel everything, place nothing | Supabase, pulled every 5 s | ≤ 5 s |
| Supabase unreachable | keep the last config for 5 min (Davies' number), then cancel all and stop | core | 5 min |
| direct kill | `POST /kill` on the Worker with `MM_SECRET`: cancel all, disarm in SQLite; started from `mm-kill.yml` (a phone can run a workflow) | Cloudflare | seconds |
| guard (dead-man) | loop's last finished decision > 5 s old, or `/beat` unreadable twice → `DELETE /1.0/orders` (all on the sub-account), read each back, report | MmGuard, monitor Worker | ≤ 7 s |
| watched back | the loop places no bid while the guard's last read of it is > 10 s old (PR5's `QUOTE_LIVE_DEADMAN_WATCH_MS`, in seconds) | core | ≤ 10 s |
| minute monitor | `monitor/health.ts` reads `agent_mm_state.updated_at`; the Worker alerts after two failing minutes | exists, one check added | 2 min |
| last resort | Cloudflare and Supabase both down: Davies cancels in the Revolut X app. That is a cancel, not a trade, and the loop's next reconcile reads it as cancelled | Davies | n/a |

The guard's cancel-all is the 10-07 lesson applied once more. A cancel costs no POST, and the re-quote after it is a
POST. A guard that fires 48 times an evening (the 10-07 stall) would use 96 POSTs, not the day. The guard holds while its
own last read found the loop fresh within 5 s ("读不到时看上次", in seconds).

### 4.3 The key

- **A new key on a new sub-account.** Davies generates the Ed25519 pair on his own machine, gives Revolut X the public half
  (trading permission; withdrawals are not offered by the API), and pastes the private half once into the Cloudflare
  dashboard. The path is Workers & Pages → `daviesportfolios-mm` → Settings → Variables and Secrets, as a Secret, under
  `MM_REVX_API_KEY` and `MM_REVX_PRIVATE_KEY`, and the same into the monitor Worker for the guard. It is never in GitHub,
  in the repository or in Supabase, never in a workflow's secrets file, and never printed. The Worker's probe reports only
  the key's form (`loadPrivateKey`'s `pkcs8-b64` …), as the agents probe does.
- Better, if Revolut X allows two keys on one sub-account: a second key for the guard alone, so the loop's and the guard's
  secrets are apart (not checked; the API docs say only "each API key directly maps to the user account").
- What a leak exposes: the sub-account's own funds, traded badly (sold into someone's bids), never withdrawn. Isolation is
  at the venue (reference §5.2). The bound is that sub-account's capital, which is why it is new and small.
- `MM_SECRET` (Worker ↔ the `mm` function) is generated and set on both sides by `mm-deploy.yml`, exactly as
  `monitor-deploy.yml` does `MONITOR_SECRET`. The `mm` function holds no Revolut X key in (C). The service-role key never
  leaves Supabase: the Worker writes through `mm?action=ingest`, which inserts into `agent_mm_*` alone.

### 4.4 Paper and live share one core

`supabase/functions/_shared/mm/core.ts` is pure TypeScript with no `Deno.` and no Workers API. Its interface is
`step(state, inputs, now) → { state, actions[] }`, plus `applyFill`, `governorLevel` and the guards. Deno imports it, and
wrangler's esbuild bundles it into the Worker; `revx.ts` is already portable (fetch and WebCrypto, no `Deno.`).

- **Paper** (§7): `mm?action=paper` runs `step` over each second of the closed minute. A simulated venue fills a resting
  quote from Revolut X's recorded prints (the replay's rules: prints through the quote, the arbitrageur at 10 bps). Its
  first test reproduces `replay.py`'s `run` fill for fill on one committed day of `backtests/cryptobooks/`, before a line
  of the live path exists.
- **Dry-run** (the live Worker, `dry_run` true): the real loop, the real inputs, the real clock, sending no order. Each
  action becomes a journal row of mode `dry`. The same simulated venue in Supabase fills those would-be quotes from the
  tape a minute later, so the dry-run measures the loop (uptime, actions a day, latency, restarts) and its P&L on one code
  path.
- **Live**: the same `step`. Only the venue adapter differs.

## 5. The data model (Supabase; one migration, its edge_calls rows in the same commit)

`agent_mm_instance` names an instance: `(id text pk, kind 'paper'|'live' immutable, book 'XRP-GBP', key_label, created_at)`.
`kind` is the identity of everything below and is never flipped; a live instance's dry-run is a separate column. That is
the "a label is not the thing it labels" lesson.

| table | key | what | rows a day |
|---|---|---|---|
| `agent_mm_config` | instance | `dry_run`, `armed_at` (kill switch), d, θ, κ, quote £, capital £, inventory cap, loss fraction, governor limits, stale and burst thresholds, `supabase_grace_s`, `updated_at` | 1 |
| `agent_mm_inputs` | (book, minute) | USDT-USD, GBP/USD, 3 h centre (bps), multiplier, sources and `computed_at` | 1,440 |
| `agent_mm_orders` | `client_order_id` uuid unique | instance, mode `paper`/`dry`/`live`, action place/replace/cancel, `replaces` (the client id before, for a PUT chain), side, price, base, fair and Binance price at the decision, `decided_at`, `sent_at`, venue ack, `venue_order_id`, state (`pending` … the venue's states, `unknown`), filled base, average price, fee, request and response json, reason | ~900 |
| `agent_mm_fills` | venue fill id (or a synthetic id for paper) | client id, side, quantity, price, fee, `ts`, fair at the fill, cause (`print`, `arb`), markouts 1/5/30/300 s | ~80 |
| `agent_mm_state` | instance | inventory base and cost, cash, realised today, marked P&L, governor counts today (POST, PUT, DELETE), `last_decision_at`, `last_binance_at`, `guard_seen_at`, mode, faults, `updated_at` | 1 (upsert) |
| `agent_mm_minutes` | (instance, minute) | decisions, actions by kind, max fair move, seconds quoted a side, Binance and multiplier ages, WS reconnects | 1,440 |
| `agent_mm_events` | id | kind: `guard_cancel`, `kill`, `pause`, `stale`, `burst`, `governor`, `restart`, `reconcile_unknown`, `ws_reconnect`, `supabase_lost`; detail json | tens |

Rules carried over from quotes_live, each a test. The journal row exists before the call. Ingest is an upsert on
`client_order_id` (a replayed outbox changes nothing), so its `edge_calls` rows (`inputs`, `paper`, `markouts`) are
`retry = true`. A partial unique index allows one open order per instance, side and mode. Reads that must see everything
page past PostgREST's 1,000 rows. `ops_errors` kinds: `agents.mm`, `monitor.mm`.

## 6. Deploy and tests

- **Workflows.** `mm-deploy.yml` mirrors `monitor-deploy.yml`: pinned wrangler, on a push touching `workers/mm/` or the
  core, after `check.yml` is green on the commit; `MM_SECRET` generated only on `rotate_secret` or when missing. The token
  needs Workers Scripts: Edit (already needed by the monitor). `mm-kill.yml` is `workflow_dispatch` only and calls `/kill`.
  `edge-functions.yml` deploys `mm`, and `migrations.yml` the tables. Durable Object classes are declared in
  `wrangler.jsonc` `migrations` (`new_sqlite_classes`).
- **A deploy restarts the object.** New code applies, the WebSocket drops, memory goes. The constructor reloads SQLite,
  checks `getAlarm()` before setting one, reconciles with the venue and quotes only after a clean reconcile. The guard
  covers the gap. Use the deferred code-update strategy with a short `max_delay`, and never deploy blind while armed: the
  workflow names `armed_at` in its summary.
- **Tests that pin it** (each with a counterfactual that fails with its part removed):
  - Deno: the core (`step`, re-price on θ, one re-price a side a second, the burst pull, sells only what it bought, the
    inventory cap, the loss stop, the governor levels, kill keeps asks, pause cancels all, stale inputs, the watched-back
    rule).
  - Parity: the paper engine against `replay.py` on a committed day.
  - The fake Revolut X, extended: PUT replace (new venue id, counted apart), cancel lag (`cancelLagReads`), 10/s buckets,
    300 active, 429 `Retry-After`, a lost reply.
  - Reconcile by client id after a kill mid-call.
  - The `mm` function's actions (`index.test.ts`); `src/cron_jobs.test.js` for the new rows (beat before work, `retry`
    stated).
  - Vitest for the Worker shell (`src/mm_worker.test.js`, as `monitor_worker.test.js`): a fake DO storage, clock and
    WebSocket. The guard at 4.9 s holds and at 5.1 s cancels all; unreadable once holds, twice cancels.
  - `docs/map.md` rows for every new file (`src/docs_map.test.js`).

## 7. Rollout

| step | what | needs | how long | read |
|---|---|---|---|---|
| 0 | freeze §7's pre-registration; build `mm?action=paper` and its tables; parity test | Davies: "freeze it" | ~1.5–2 agent-days | 28 days from the first 00:00 UTC after it runs |
| 1 | build the core, the Worker, `mm` (config, inputs, ingest), the guard, the workflows; all tests | nothing live | ~4 agent-days, alongside step 0 | gates |
| 2 | deploy `daviesportfolios-mm` with **no key**: WS, clock, config pull, outbox; dry-run decisions on fake orders | Davies: Workers Paid, the deploy | 2 days | uptime %, decisions a day, restarts, alarm lateness |
| 3 | a **read-only** key on the new sub-account: `balances`, `orders/active` each second from Cloudflare; measure Revolut X's answer from Cloudflare's egress (geo, 403, 429), latency | Davies: the sub-account, the read-only key pasted | 7 days dry-run | all of step 2, the request budget at the real limits |
| 4 | the first live order is the test (Revolut X has no dry run): one post-only bid 2 % under the touch at the minimum size; PUT it once (new venue id, still post-only, not counted?); cancel; cancel-all; read each back; record in the reference | Davies: a trading key, "go" | 1 hour | the venue's answers |
| 5 | armed small: £50 a quote, £150 capital, inventory cap £100, −1 % a day; live-watch each day | Davies: "go", after the paper verdict | 7 days | P&L against the paper on the same days, fills, markouts, guard fires |
| 6 | the pre-registered size (£200 a quote, £600) | Davies: his word | | |

Every "go" is said by Davies in the conversation where it runs, with its undo beside it (null `armed_at`; global pause).
Never trade by hand in that sub-account: the loop books its balance as its own.

## 8. What only Davies can decide

1. **Cloudflare Workers Paid** on the account that runs the monitor: $5 a month minimum, $6–9 expected. Without it, A′ is
   the only way to one second.
2. **Where the key lives:** (a) a Cloudflare Worker secret alone (recommended; Supabase never sees it); (b) Supabase alone,
   as every key today, which means A′; (c) both, a second key for a Supabase-side minute dead-man of last resort. He
   creates and pastes it; no session moves it.
3. **A new Revolut X sub-account** for this loop alone (never the loop's, PR5's `_2` or RXU's), and its capital. A second
   one if SOL-GBP runs live beside XRP-GBP.
4. **Fail-closed time** when Supabase cannot be reached (recommended 5 minutes; the kill switch and the pause live there).
5. **The phone kill** through `mm-kill.yml`: acceptable?
6. **Journal before the call in the object's SQLite, mirrored to Supabase seconds later**, instead of the existing executors'
   row in Supabase before every call. This is recommended: a database stall must not stop the order path, nor make it
   blind.
7. **Freezing the §7 pre-registration**, which starts the paper test independently of everything above.

## 9. Not checked, and what would change the answer

- Whether Revolut X answers Cloudflare's egress the way it answers eu-west-2 (no IP block, no geo rule): step 3 measures it.
  If it refuses, (C) and (B) are out and A′ (or D) is the design.
- PUT replace, untested on the live venue: does it keep `post_only` and the queue? Is it really outside the day's count? Do
  cancels count? Is "the daily limit does not apply to sub-accounts" true? Step 4 answers each; the governor assumes the
  worst until then.
- A′'s CPU per 170 s with signing and the active-orders read: unmeasured (the SPEED figure is a keyless poll).
- Durable Object alarm lateness, and whether a client WebSocket's incoming messages are billed: Cloudflare's pages state
  neither. Step 2 measures both.
- Latency from `weur` to Revolut X and to Binance's stream: unmeasured. The figures here are eu-west-2's order path and this
  container's stream.
- Whether Ed25519 PKCS#8 import works in workerd as in Deno: the table lists `importKey` for Ed25519, not the format.
- The strategy agent's own requirements (more books, a different θ, a taker leg such as §4.3's stale take) may change the
  request budget, not the shape. One object per sub-account and book scales to the 300-active and 10/s limits.

## 10. Sources

- Cloudflare, read 2026-10-31: Durable Objects pricing (`developers.cloudflare.com/durable-objects/platform/pricing/`), limits
  (`…/durable-objects/platform/limits/`), lifecycle (`…/durable-objects/concepts/durable-object-lifecycle/`), alarms
  (`…/durable-objects/api/alarms/`), data location (`…/durable-objects/reference/data-location/`); Workers pricing
  (`…/workers/platform/pricing/`), limits (`…/workers/platform/limits/`), secrets (`…/workers/configuration/secrets/`),
  Web Crypto (`…/workers/runtime-apis/web-crypto/`), WebSockets (`…/workers/runtime-apis/websockets/`).
- Supabase, read 2026-10-31: Edge Function limits (`supabase.com/docs/guides/functions/limits`: 256 MB, wall 150 s Free /
  400 s paid, CPU 2 s a request, idle 150 s), pricing (`…/functions/pricing`: Pro 2 M included, $2 per million),
  background tasks (`…/functions/background-tasks`), WebSockets (`…/functions/websockets`: outbound allowed), Cron
  (`…/guides/cron`: every second; ≤ 8 jobs at once advised).
- Revolut X: `developer.revolut.com/docs/x-api/revolut-x-crypto-exchange-rest-api`, read whole 2026-10-31 (Replace order
  `PUT /api/1.0/orders/{venue_order_id}`, "Replacing orders does not count towards the daily limit", 10/s; "The daily
  limit does not apply to sub-accounts"; 300 active a sub-account; no WebSocket named); reference §2, §5.
- Binance: `developers.binance.com/docs/binance-spot-api-docs/web-socket-streams` (`<symbol>@bookTicker`, real-time),
  `…/rest-api/general-api-information` (`data-api.binance.vision` for public data);
  `data-api.binance.vision/api/v3/exchangeInfo?symbol=XRPUSDT` (REQUEST_WEIGHT 6,000 a minute; tick 0.0001); the stream
  probe from this container, 2026-10-31 09:11–09:15 UTC.
- SQL, read-only, project `flmvxigozjuizpckllvk`, 2026-10-31 ~09:20 UTC:
  - `select count(*) … from public.edge_call_beats where minute > now() - interval '24 hours'` → 29,723 beats, 1,440 minutes;
  - `edge_call_retries` the same window → 2,337 re-runs (2,166 ok, 142 excluded, 29 failed);
  - `percentile_cont(array[0.5,0.9,0.99]) … extract(epoch from ts - minute) … path like 'agents?action=quotes%'` → 0.70 / 6.09 / 13.5 s;
  - `percentile_cont(array[0.1,0.5,0.9,0.99]) within group (order by (response->>'created_date')::bigint - extract(epoch from ts)*1000) from public.agent_quote_live_orders where ts > now() - interval '3 days' and mode = 'live'` → 66 / 82 / 110 / 178 ms over 1,288 orders;
  - `pg_extension` → pg_cron 1.6.4, pg_net 0.20.0, no `http`.
- In the repository: `backtests/speed/results/architectures.json` and `infra.json` (SPEED, 2026-09-27); `workers/monitor/`;
  `supabase/functions/monitor/deadman.ts`; `supabase/functions/agents/quotes_live.ts`; `supabase/functions/_shared/revx.ts`.
