# Polymarket's order path, built inert (2026-10-01)

## On whose word

The live pre-study (`2026-10-01-polymarket-live-prestudy.md`) put three options to Davies. On 2026-10-01 he chose
Option 1, verbatim:

> “选项 1：违反原规则的先后顺序，在 RW-C 期间先把下单通道建好、只空跑，可以早约 5–7 天” - 这个你现在就建好吧
> 我之后长期在爱尔兰，如果变动需要更改会和你说，不和你说关就一直没事 也不用问我

In English: "'Option 1: break the frozen ordering, build the order path during RW-C, dry-run only, about 5–7 days
sooner' — build this now. From now on I will be in Ireland long-term; if that changes I will tell you; until I tell
you, it stays on, and there is no need to ask me."

Option 1, as the pre-study words it: "build the rule-independent path (signing, client, reconciliation, gates, caps)
during RW-C, inert, with any dry-run only on markets outside RW's universe and nothing of `pm_rwc_*` read." It is a
recorded deviation of RW-NEXT's ordering ("before any live test or design"), not of any frozen test: nothing here
reads, changes or depends on RW's, RW-E's, the variants' or RW-C's tables, rules or results.

His second sentence changes one thing RW-NEXT Part 4 says. Part 4 has the attestation as "an expiring timestamp, set in
the conversation where he says so". On his word it is a standing one: set once, current until he says otherwise. The
schema still takes an expiry (`ireland_until` in the future), so an expiring attestation remains one statement away.

## What is built

| File | Lines | What it is |
|---|---:|---|
| `supabase/functions/_shared/polymarket_orders.ts` | 620 | The CLOB V2 order: its EIP-712 struct, hash (the order id) and signature; the tick rounding; the `POST /order` and cancel bodies; the L2 headers; the one wire function and its route list; the env loader that never reads the private key; the venue interface the executor uses. |
| `supabase/functions/agents/pm_live.ts` | 897 | The executor: one turn a minute under its lease, the gates, close-only, the caps, the governor, the loss stops, pending-before-POST, reconciliation by hash, cancel-then-post, the day's market selection, the dry-run record. |
| `supabase/migrations/0074_pm_live.sql` | 216 | Six `pm_live_*` tables with RLS, the config row (dry-run, unarmed, attested), the lease row, and one row added to `edge-calls-every-minute`. |
| `supabase/functions/agents/pm_live.test.ts` | 994 | 46 tests of the executor against the strict doubles. |
| `supabase/functions/agents/polymarket_orders.test.ts` | 295 | 21 tests of the order, the wire and the env loader against the official clients' vectors. |
| `supabase/functions/agents/testing.ts` | +444 −3 | `pm_live_*` in the in-memory database with 0074's checks, unique indexes and foreign key; `onlyTables`, which refuses any table outside a module's list; `FakePolymarket`, a CLOB that refuses what the CLOB refuses. |
| `supabase/functions/agents/index.ts` | +42 −1 | `POST ?action=pmlive` (cron bearer only) and `runPmLiveAction`, which never throws and sends its errors to `ops_errors`. |
| `supabase/functions/agents/db.ts` | +2 | The fills table's paging key. |
| `supabase/functions/_shared/polymarket.ts` | +2 −2 | `secretForms` exported; nothing else changes, and it stays GET-only. |
| `src/cron_jobs.test.js` | +27 | The job after 0074 is the job before it plus one row, every other row byte for byte. |
| `docs/agents/backtests/pmlive/vectors/` | 9 files | The vectors' generator, its lockfile, the vectors, the Python cross-check and its output, a manifest. |

The new code's only third-party imports are `npm:@noble/curves@2.0.1` and `npm:@noble/hashes@2.0.1`, the two packages
`_shared/polymarket.ts` already pinned. No dependency was added.

## The order

- **Domain and struct.** `{ name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract }`, the
  CTF Exchange `0xE111180000d2663C0091e4f400237545B87B996B` for a standard market, the Neg Risk CTF Exchange
  `0xe2222d279d744050d28e00520010520000310F59` for a neg-risk one. `Order(uint256 salt, address maker, address signer,
  uint256 tokenId, uint256 makerAmount, uint256 takerAmount, uint8 side, uint8 signatureType, uint256 timestamp,
  bytes32 metadata, bytes32 builder)`; BUY 0, SELL 1; the timestamp in milliseconds; `expiration` rides in the body
  and is not signed.
- **The id is the hash.** An order's id is its EIP-712 digest, so the path knows it before the POST and writes the
  pending row under it. Computing it needs no key: the dry-run writes real ids without loading one.
- **Signature type 1 (POLY_PROXY).** The maker is the proxy wallet (`POLYMARKET_FUNDER_ADDRESS`), the signer the EOA
  (`POLYMARKET_SIGNER_ADDRESS`). A signature is `r ‖ s ‖ v` with v 27 or 28 and a low s; `recoverSigner` refuses
  anything else, as the exchange does.
- **Amounts.** The official client's `ROUNDING_CONFIG`, price / size / amount decimals by tick: 0.1 → 1/2/3,
  0.01 → 2/2/4, 0.005 → 3/2/5, 0.0025 → 4/2/6, 0.001 → 3/2/5, 0.0001 → 4/2/6; then six-decimal base units, through the
  decimal string so a binary float such as 19.99 cannot land a unit low. A BUY gives `size × price` and takes `size`;
  a SELL the reverse.
- **The body,** in the client's key order: `{ deferExec, postOnly, order: { salt (a JSON number, so the salt stays
  under 2^48), maker, signer, tokenId, makerAmount, takerAmount, side ("BUY"/"SELL"), signatureType, timestamp,
  expiration, metadata, builder, signature }, owner: <api key>, orderType }`. The L2 HMAC is over that exact text.
- **Pinned to the official clients.** `backtests/pmlive/vectors/gen_vectors.mjs` builds eight orders (both sides, both
  exchanges, all six ticks) with `@polymarket/clob-client-v2` 1.2.0, offline, with Hardhat's published test key #0 and
  each case's timestamp and salt fixed; it regenerates `vectors.json` byte for byte. `polymarket_orders.test.ts`
  reproduces every amount, domain separator, struct hash, hash, signature, recovery, body and L2 signature. The
  Python client (`py_clob_client_v2` 1.2.0) gives the same eight hashes and signatures (`check_py_out.txt`). The
  official repository's own vector (py-clob-client-v2 `EXPECTED_POLY_1271_SIGNATURE`, Amoy) gives the same domain
  separator and struct hash. On rounding the two clients differ in 3 of 24 cases (19.99 shares BUY and SELL at 0.57,
  0.29 shares SELL at 0.995): the Python helpers floor binary floats. The path follows the TypeScript client.

## The wire

`pmOrderCall` is the only function that reaches Polymarket, and it decides in this order, before a header is built or
a request made:

1. The request must be one of `PM_ORDER_ROUTES`: GET `/book`, `/rewards/markets/current`, Gamma's `/markets/keyset`,
   the geoblock, and on L2 `/auth/ban-status/closed-only`, `/balance-allowance`, `/data/order/{id}`, `/data/trades`;
   POST `/order`; DELETE `/order` and `/cancel-all`. Anything else is refused (`route`).
2. A POST must come from a runtime whose `SB_REGION` is `eu-west-1`, read from the environment at the call (`region`).
   A DELETE may come from any region, so a kill switch never depends on one.
3. While `PM_ORDER_SENDS_ENABLED` is false, nothing but a GET leaves (`sends-disabled`). It is false in this build.
4. L2 headers go to the CLOB host only; no redirect is followed; every call times out (5 s from the action); every
   upstream error is scrubbed of every credential, in every spelling it could come back in, before it is cut.

`_shared/polymarket.ts`, the probe's client, stays GET-only; the order code is in the new modules.

## The executor, one turn

The turn claims the `pm-live` lease (55 s), then:

1. **The day's markets.** Once a UTC day (a kind not found is tried again every five minutes): every page of
   `/rewards/markets/current`, native and sponsored, then Gamma's open markets in its order by 24-hour volume (five
   pages of 100 at most), each candidate's YES book in turn (40 reads at most). The first standard and the first
   neg-risk market that accepts orders, has two tokens, a two-sided book agreeing with Gamma about `neg_risk`, and a
   daily reward rate under $10 or none, are taken. RW's universe is $10 and over, so these are never RW's or RW-C's.
   A reward listing not read to its end takes nothing: without it RW's universe cannot be told apart. RW's ranking
   code is not used. **A market whose game starts, or which ends, within two days is passed over** (Gamma's
   `gameStartTime` and `endDate`; added the same day, after the first standard pick, a China Open match chosen at
   05:31 UTC, closed at 06:27: its `endDate` was a week on, its game had started at 03:05). **A selected market whose
   book answers 404 has left the book**: the turn records it once in the minute's selection event, its orders are
   closed as for any unreadable book, it is not read again that day, and its kind is chosen again without it on the
   next try; before this, every turn reported the 404, 211 rows of `ops_errors` in four hours.
2. **What the venue says.** The geoblock for this runtime's address, the account's closed-only flag, each market's
   book, what the account holds of each token (`/balance-allowance?asset_type=CONDITIONAL&token_id=`); in live mode
   every open order read back by its hash, and its trades until `CONFIRMED` or `FAILED`.
3. **The gates** (`gates`), in this order; the first that fails is the one recorded:

| Gate | Passes when | Stops a sell too? |
|---|---|---|
| `global_pause` | `agent_risk.global_pause` is off. On: cancel everything (one `DELETE /cancel-all` in live), place nothing | yes |
| `risk_readable` | `agent_risk` could be read (unread, it might be paused) | no |
| `armed` | live only: `pm_live_config.live_confirmed_at` is set. In a dry-run it decides nothing, so the dry-run shows what live and armed would send | no |
| `region` | the runtime's `SB_REGION` is `eu-west-1` | yes |
| `geoblock` | the geoblock answers country `IE` | only for a country blocked completely (OFAC) |
| `closed_only` | the account's flag reads `false` (unread is closed) | no |
| `attestation` | Davies' Ireland attestation is current | no |
| `inventory` | every token balance could be read | yes |
| `loss_day` | today's P&L is above −$25 (a stop recorded today holds to the next UTC day) | no |
| `loss_total` | the run's P&L is above −$75 (a recorded stop holds until a person clears it) | no |

   The geoblock gate is the country, not `blocked`: from eu-west-1 the geoblock answered `blocked: true` with country
   IE on 2026-09-24 (reference §6). It answers for polymarket.com's frontend, where Ireland is close-only, while "the
   API itself is not restricted". Read literally, "not blocked and IE" would never open.
4. **Close-only, exactly as RW-NEXT Part 4 words it** (`closeOnly`). While any gate stops opening: no buy at all; our
   bid (BUY YES at b) becomes a SELL of NO at 1 − b if NO is held, our ask (BUY NO at 1 − a) a SELL of YES at a if YES
   is held, each for at most what is held; a sell under the market's minimum size is dropped; a flat market rests
   nothing.
5. **The quotes, the caps and the governor.** The rule's intents (`placeholderQuotes` now: BUY YES at the best bid
   and BUY NO at 1 − the best ask, at the minimum size), each checked against the venue's rules (tick, range, minimum,
   expiration) and post-only (one that would take is withheld). Each slot (market, token, side) holds at most one
   order, which 0074's partial unique index enforces in the database too. The caps, on what would rest after the
   turn: buys' collateral (N × b, N × (1 − a)) plus the holdings at cost (a holding no fill explains at $1 a share)
   stay within $60 a market and $300 in all; a config row may lower each and never raise it. The governor stops POSTs
   at 6,000 a UTC day.
6. **The orders.** Cancels first. A slot whose order is right is left alone; one whose price changed, or with 90 s or
   less of effective life left, is cancelled and its replacement sent only once the cancel is READ BACK; a cancel the
   venue still shows open freezes the slot. In live mode every order is written `pending`, keyed by its hash, before
   the POST. A 4xx with an error or `success: false` is a refusal, and the same quote is not sent again until its price
   or size changes; a 425 (engine restart) or a 429 is "not taken" and is sent again next turn as a new order; a 5xx,
   a timeout or a lost reply says nothing, and the row stays `pending` until a read-back by hash settles it; one the
   venue shows nowhere stays pending for a person, and its slot sends nothing. Every order is GTD and post-only, sent
   with expiration now + 60 + 300 s (the venue ends a GTD order a minute early): an order this path loses track of dies
   on its own five minutes after it was sent at the default lifetime, ten at the most a config row allows.
7. **Time.** It shares the one-minute job's batch, so no selection read starts later than 40 s into the turn, no order
   is sent later than 40 s, and a live POST goes only while the turn still holds its lease, renewed once half of it is
   gone (PR5's executor's rule; stricter in one way: a renewal that cannot be confirmed stops the sending). The GTD
   lifetime's floor is 180 s, not the docs' "about two minutes", so an order sent at 40 s and answered at its 5 s
   timeout still reaches the venue with the 3 minutes it requires (195 s, pinned).

P&L counts `CONFIRMED` fills only, at average cost, marked at the mid; the day's figure counts every holding's
unrealised P&L (stricter than counting only today's).

## What the dry-run records

Every minute, from eu-west-1 (`agents?action=pmlive&forceFunctionRegion=eu-west-1`):

- `pm_live_state` (one row, rewritten each minute): the runtime's `SB_REGION`, the mode and why, every gate's verdict,
  the geoblock's answer, the closed-only flag, the attestation, the limits, the books met, the holdings, the orders
  wanted and withheld with the gate that withheld each, the day's POST count, the P&L, the last error.
- `pm_live_events`, only on change: the gates' verdicts when any changes (with the runtime's region and country), each
  selection with what it read and how long it took (`ms`), the governor, the loss stops.
- `pm_live_orders`, only on change: each order it would send, with its hash, market, token, outcome, side, price,
  size, `GTD`, expiration, `neg_risk`, the gate it went under (`open` or `reduce`), the book it met, and the order
  struct without its signature; each cancel with its gate and reason; a dry-run order the venue would have expired
  is marked expired. A touch that does not move writes nothing.
- `pm_live_markets`: the day's two markets and their reward rate and rank.

It never loads `POLYMARKET_PRIVATE_KEY` (the env loader never asks for it, pinned), so nothing is signed, and no
signature is written anywhere (pinned over the whole database after a dry-run turn, and after a live test turn that
sent four). A read of RW's or RW-C's tables is refused by the test double (`onlyTables`: the six `pm_live_*` tables,
`agent_risk` read-only, and its own lease row only); three hours of turns touch nothing else.

## The attestation and its revocation

0074 sets `ireland_attested_at` to the moment it runs and `ireland_until` to null: standing, on Davies' word. Running
0074 again cannot re-attest after a revocation (the seed only sets the attestation when the row is new). Revoking it is
one statement, run in the conversation where he says he has left Ireland:

    update public.pm_live_config set ireland_until = now() where id = 1;

From that instant the path may only reduce or close. A later return is recorded the way it was set:

    update public.pm_live_config set ireland_attested_at = now(), ireland_until = null where id = 1;

An expiring attestation, Part 4's original shape, is `ireland_until` set to a future time. Pinned both ways:
`attestationCurrent` (none; standing; an expiry ahead; revoked at this instant; expired; attested in the future; either
timestamp unreadable) and the turn test that revokes it with the statement's effect, sees the path go close-only from
that instant, and attests again to see it open. Both statements were run as written against 0074 in PGlite.

## The one-minute job

0074 re-schedules `edge-calls-every-minute` with 0072's list plus one row:
`('agents?action=pmlive&forceFunctionRegion=eu-west-1', 58000, 1, 23)`. The job sends one set of headers for every
call, so the region rides in the call's own path: `forceFunctionRegion` is Supabase's documented alternative "in case
you cannot add the `x-region` header to the request". `src/cron_jobs.test.js` pins that the list after 0074 is the
list before it plus this row, every other row (RW's `pmrw*` until 10-09, RW-C's `pmrwc*`) byte for byte, the
headers, body, filter and schedule unchanged. In PGlite the job's command, run as written for 10:00 UTC, queued 16
calls, the order path's to `…/functions/v1/agents?action=pmlive&forceFunctionRegion=eu-west-1` with a 58 s timeout.

0074 was applied to PGlite 0.5.8 (PostgreSQL 16) twice, with stubs for what it names outside its own tables. Every
refusal the in-memory double makes was tried there and gave the same constraint name: the hash once
(`pm_live_orders_hash_key`), one open order per slot (`pm_live_orders_one_open_per_slot`, on insert and on an update
that would reopen one), the hash's form, `GTD`, post-only, the price range, the gate, a fill only of a known order
(`pm_live_fills_hash_fkey`), the trade status (the OpenAPI's `TRADE_STATUS_` spelling refused: the path writes the
bare one), a market only under $10, the kind matching `neg_risk`, the caps' ceilings, the GTD lifetime's bounds (179
and 601 refused, 180 allowed), an `ireland_until` without an attestation, one config row, the event kinds.

## Tests and counterfactuals

`pm_live.test.ts` 46 tests and `polymarket_orders.test.ts` 21, all 67 passing on Deno 1.46.3 with type checks;
`src/cron_jobs.test.js` one more. The executor's tests run against `memDb` (0074's checks) held by `onlyTables`, and `FakePolymarket`, which
refuses an order whose owner, order type, salt, signature type, signer or maker is wrong, whose signature does not
recover to the signer over its token's exchange, a duplicate, an expiration under 3 minutes ahead, a price off the
tick, a size under the minimum, a buy from a country other than IE, a buy in closed-only mode, a post-only order that
would take, and an order the balance cannot cover; its HTTP adapter answers 401 to a private route without L2
headers and throws if they are sent anywhere else. A full simulated day through the REAL client sends not one request
but a GET, as deployed and with a live config, a key and a caller that claims sends are on.

Each gate and guard below was removed alone from the source and both test files run (`--no-check`); the source was
restored and its sha256 checked after each. All but one fail at least one pin:

| Removed alone | Pins failing | Which |
|---|---:|---|
| gate global_pause (open) | 2 | “gates: every gate passing opens”; “global pause: every open order cancelled, nothing placed” |
| gate risk_readable | 3 | “agent_risk unreadable: nothing opens (it might be paused)”; “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…” |
| gate armed | 4 | “armed: in live mode `live_confirmed_at` cleared places nothing that…”; “gates: every gate passing opens”; “gates: in a dry-run `live_confirmed_at` decides nothing (the dry-run…”; “gates: reducing survives every gate but the pause, the region, a…” |
| gate region (open) | 3 | “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…”; “region: a runtime that is not eu-west-1 places nothing and withdraws…” |
| gate geoblock (open) | 3 | “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…”; “geoblock: a country that is not IE is close-only” |
| gate closed_only | 3 | “closed-only: the account's flag (or a flag that cannot be read) makes…”; “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…” |
| gate attestation | 3 | “attestation: revoked with one statement's effect, the path is…”; “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…” |
| gate inventory (open) | 2 | “gates: every gate passing opens”; “inventory: holdings that cannot be read open nothing and sell nothing” |
| gate loss_day | 3 | “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…”; “loss stops: past the day's limit nothing opens for the rest of the UTC…” |
| gate loss_total | 3 | “gates: every gate passing opens”; “gates: reducing survives every gate but the pause, the region, a…”; “loss stops: past the day's limit nothing opens for the rest of the UTC…” |
| reduce: global pause | 1 | “gates: reducing survives every gate but the pause, the region, a…” |
| reduce: region | 2 | “gates: reducing survives every gate but the pause, the region, a…”; “region: a runtime that is not eu-west-1 places nothing and withdraws…” |
| reduce: OFAC country | 2 | “gates: reducing survives every gate but the pause, the region, a…”; “geoblock: a country that is not IE is close-only” |
| reduce: inventory read | 2 | “gates: reducing survives every gate but the pause, the region, a…”; “inventory: holdings that cannot be read open nothing and sell nothing” |
| kill switch: cancel everything on the global pause | 2 | “gates: reducing survives every gate but the pause, the region, a…”; “global pause, live: one cancel-all, every open order read back…” |
| lock: PM_ORDER_SENDS_ENABLED in the executor | 1 | “the three locks: sends disabled in code, dry_run on, or no key matching…” |
| lock: dry_run | 1 | “the three locks: sends disabled in code, dry_run on, or no key matching…” |
| lock: the key matching the stored signer | 1 | “the three locks: sends disabled in code, dry_run on, or no key matching…” |
| closeOnly: a buy passes through | 7 | “agent_risk unreadable: nothing opens (it might be paused)”; “armed: in live mode `live_confirmed_at` cleared places nothing that…”; “attestation: revoked with one statement's effect, the path is…”; “closeOnly, case by case: no buy ever”; and 3 more |
| closeOnly: a sell not capped at the holding | 6 | “agent_risk unreadable: nothing opens (it might be paused)”; “armed: in live mode `live_confirmed_at` cleared places nothing that…”; “attestation: revoked with one statement's effect, the path is…”; “closeOnly, case by case: no buy ever”; “closed-only: the account's flag (or a flag that cannot be read) makes…”; “geoblock: a country that is not IE is close-only” |
| close-only ignored when opening is stopped | 8 | “agent_risk unreadable: nothing opens (it might be paused)”; “armed: in live mode `live_confirmed_at` cleared places nothing that…”; “attestation: revoked with one statement's effect, the path is…”; “closed-only: the account's flag (or a flag that cannot be read) makes…”; and 4 more |
| cap: total | 1 | “caps: buys' collateral (N × b, N × (1 − a)) and the holdings' cost stay…” |
| cap: per market | 2 | “caps: buys' collateral (N × b, N × (1 − a)) and the holdings' cost stay…”; “closed-only: the account's flag (or a flag that cannot be read) makes…” |
| governor: POSTs a day | 1 | “the governor: at the day's POST limit nothing more is sent, once…” |
| send deadline | 1 | “the selection's deadline: no read starts 40 s into the turn” |
| lease held before a live POST | 1 | “live: an order is sent only while the turn holds its lease, renewed…” |
| selection deadline (reward listing) | 1 | “the selection's deadline: no read starts 40 s into the turn” |
| pending row before the POST | 3 | “a POST whose reply is lost stays pending”; “live: every order is written pending, keyed by its hash, BEFORE its POST”; “unknown is never rejected: a 5xx leaves the order pending” |
| a 5xx or a lost reply is unknown, not rejected | 2 | “postOutcome: an explicit refusal is rejected, a 425 or 429 rejected and…”; “unknown is never rejected: a 5xx leaves the order pending” |
| an order shown nowhere stays pending for a person | 1 | “unknown is never rejected: a 5xx leaves the order pending” |
| replacement only after the cancel is read back | 1 | “an order that fills while it is being cancelled is not replaced in that…” |
| a slot with an unknown or frozen order tries no second order | 1 | “unknown is never rejected: a 5xx leaves the order pending” |
| wire: an L2 route on another host (Gamma's listing marked L2) | 4 | “PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real…”; “a GET goes out as a GET, follows no redirect, carries L2 headers only…”; “agents?action=pmlive: it never asks for the private key, records the…”; “pmOrderCall reaches only its routes: every other path, method, host or…” |
| a refused quote is not sent again | 1 | “an explicit refusal is rejected and the same quote is not sent again” |
| selection: the $10 reward-rate filter | 31 | “0074's constraints hold in the double: one open order per market, token…”; “PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real…”; “a POST whose reply is lost stays pending”; “a market with a reward rate of $10 or more is never chosen: 300 random…”; and 27 more |
| selection: an unread reward listing takes nothing | 3 | “selectMarkets: the first standard and the first neg-risk market outside…”; “the day's selection is made once, retried every five minutes while a…”; “the selection's deadline: no read starts 40 s into the turn” |
| the executor reads RW-C's table | 28 | “0074's constraints hold in the double: one open order per market, token…”; “PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real…”; “a POST whose reply is lost stays pending”; “agent_risk unreadable: nothing opens (it might be paused)”; and 24 more |
| wire: PM_ORDER_SENDS_ENABLED = true | 3 | “PM_ORDER_SENDS_ENABLED is false in this build”; “PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real…”; “pmOrderCall sends no POST and no DELETE while sends are off: a POST…” |
| wire: the non-GET refusal | 2 | “PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real…”; “pmOrderCall sends no POST and no DELETE while sends are off: a POST…” |
| wire: a POST only from eu-west-1 | 1 | “pmOrderCall sends no POST and no DELETE while sends are off: a POST…” |
| wire: the route allowlist | 1 | “pmOrderCall reaches only its routes: every other path, method, host or…” |
| wire: L2 headers to the CLOB only | 0 | **none** (see below) |
| env: the private key read | 2 | “agents?action=pmlive: it never asks for the private key, records the…”; “loadPmLiveEnv never reads POLYMARKET_PRIVATE_KEY: no key is loaded in…” |

42 of the 43 removals fail at least one pin. The one that fails none is the wire's second check that L2 headers go to
the CLOB host: every L2 route in `PM_ORDER_ROUTES` is on that host, so the check is unreachable while the list holds,
and the list is what is pinned (a route on another host marked L2, the row above it, fails four). It stays, as a second
guard for a route added later. The send deadline is pinned in the second half of the selection-deadline test, and the
replace-after-read-back rule by a cancel that finds its order filled: the slot guard and the database's
one-open-order-per-slot index are two more layers behind it, each pinned on its own (the slot guard above; the index in
`0074's constraints hold in the double` and in PGlite).

## The pre-study's twelve preconditions

| # | Precondition | Now |
|---|---|---|
| 1 | RW-NEXT Part 1 names a candidate (on or after 10-09 00:05 UTC) | not yet |
| 2 | RW-C passes (on or after 10-23 00:05 UTC) | not yet |
| 3 | Davies' word on the live design, given after 10-23 | not yet |
| 4 | The live test pre-registered and frozen | not yet |
| 5 | The order path built in a new module, pinned, with both gates, caps, kill switches, reconciliation and strict doubles | **this build** (on review and push) |
| 6 | At least a day of dry-run in `eu-west-1`, watched | starts with the push: the first minute shows whether `forceFunctionRegion` lands in eu-west-1 (`state.sbRegion`) |
| 7 | The wallet decided, the unused allowances and the other tool's token revoked | not yet (his) |
| 8 | The probe reads the account as not closed-only, before and after funding | not yet; the dry-run reads the flag every minute and records a change |
| 9 | His Ireland dates cover phase 2, his attestation set in conversation with an expiry | set, standing until he revokes it, on his word of 2026-10-01 (above) |
| 10 | The Terms bar stated in the design as his accepted risk | for the live design |
| 11 | The $5 test transfer confirmed, then the rest | not yet |
| 12 | His confirmation of the first live order in that conversation | not yet |

## What going live needs

Three locks keep this build from sending, each enough alone, each pinned: `PM_ORDER_SENDS_ENABLED = false` in code
(the wire refuses every POST and DELETE); no key loaded (the action passes no signer, and the env loader never reads
`POLYMARKET_PRIVATE_KEY`); and `dry_run` on (0074 sets it, and sets it again if re-run). Going live is all of: a
reviewed commit that sets the constant and loads the key, and in the conversation where Davies says go, after RW-C's
verdict and the live design, `dry_run = false` and `live_confirmed_at` set. The placeholder rule is replaced by the
candidate's (`PmQuoteRule`). The live design also settles what a market that resolves while held leaves: its tokens
are read no more once its book is gone, so its inventory must be redeemed (the Relayer, or by hand) and counted until
it is; in this phase the path holds nothing.

## Not verified

- That a live POST's reply names the order by our hash. The docs' ids are 32-byte hex and the clients compute the hash
  the same way; a reply naming another id leaves the row pending for its read-back.
- What a read-back says of an expired GTD order (the fake answers `CANCELED`; a status the path does not know is left
  for a person).
- Whether `min_order_size` is in shares: trading/place-orders says shares; the pre-study read a disagreement. Only a
  live order can settle it.
- The API's Irish exemption, and the refusal's wording for a blocked country: only an order can show either.
- `forceFunctionRegion` through pg_net: the 2026-09-24 probe used the `x-region` header; the first minute after the
  push shows the parameter's effect.
- Whether the venue checks an order's `timestamp` for freshness (an order may leave up to 40 s after its turn's start).
- `500 order timed out`, documented as "rejected before reaching the order book and can be safely resubmitted": the
  path still treats it as unknown until a read-back, and a 404 read-back leaves it for a person.
- How long the reward listing takes from eu-west-1 (36 s from Atlanta), and a selection turn's CPU against the Edge's
  2 s: the selection records `ms`.
- That the server accepts the POST's L2 HMAC: no POST has been sent; the HMAC is the official client's over the exact
  body, pinned against its vectors.
- Heartbeats are never started: the first would arm a cancel of every order 10 s after the last, which a minute loop
  cannot keep.

## Sources

Read 2026-10-01 unless stated.

- docs.polymarket.com: `trading/place-orders` (GTD's minute, the 3-minute minimum, `min_order_size` in shares, the
  rounding table), `trading/manage-orders` (cancels, heartbeats), `trading/market-making` ("Orders cannot be edited in
  place"), `trading/wallets-auth`, `trading/matching-engine` (425, two minutes post-only), `concepts/order-lifecycle`,
  `resources/error-codes` (`order crosses book`, `order timed out`), `resources/contracts`, `api-reference/geoblock`
  (eu-west-2, "Closest Non-Georestricted Region: eu-west-1"), `api-reference/trade/get-single-order-by-id`,
  `api-reference/trade/get-trades`, the CLOB OpenAPI (`/rewards/markets/current` 500 a page, `/balance-allowance`),
  Gamma's OpenAPI, `changelog/sdks` (0.1.0-beta.12: "Require GTD limit order expirations to be at least 3 minutes in
  the future").
- `@polymarket/clob-client-v2` 1.2.0 (npm; source at github.com/Polymarket/clob-client-v2, commit `8046a89e`,
  2026-09-25) and `py_clob_client_v2` 1.2.0 (PyPI; github.com/Polymarket/py-clob-client-v2, commit `292c1100`,
  2026-09-25): the order builder, `orderToJsonV2`, `ROUNDING_CONFIG`, `createL2Headers`, the tests' vectors.
- supabase.com/docs/guides/functions/regional-invocation (`x-region`, `forceFunctionRegion`, `x-sb-edge-region`) and
  /guides/functions/secrets (`SB_REGION`).
- Reference §2d and §6 (the 2026-09-24 probes from eu-west-2 and eu-west-1), RW-NEXT Part 4
  (`2026-09-28-rw-next-prereg.md`), the live pre-study.
- Measured, keyless, 2026-10-01 04:43 UTC from this container (Cloudflare's Atlanta edge): `/rewards/markets/current`
  is 38 native pages and 1 sponsored, 18,600 rows, 6.5 MB, 36 s in sequence.
