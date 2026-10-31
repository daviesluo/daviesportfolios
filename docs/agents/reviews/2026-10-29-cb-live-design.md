# Coinbase live: "Stablecoin quotes USDC/GBP", the design and the go (CB-LIVE, 2026-10-29)

**Status: built, DRY-RUN and UNARMED.** Nothing is sent to Coinbase until Davies says go in the conversation where the go
statement (§7) is run. Since 2026-10-30 it can decide for itself (§10); it lands following the paper arm, with the shadow on.

## 0. On whose word

- Davies, 2026-10-29: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线" (build the Coinbase live set-up and prepare
  "with Euros - 2" to go live).
- Then: "目前没有太多钱，我刚往我这个coinbase账户转了120磅，先把"with Euros - 2"用120磅资金上限，上线后live策略名字叫Stablecoin quotes
  USDC/GBP" (there is not much money for now; I have just moved £120 into this Coinbase account. Start "with Euros - 2" with a
  £120 cap; once live, the strategy is called "Stablecoin quotes USDC/GBP").
- He stored the key the same day as the Edge Function secrets `COINBASE_API_KEY_NAME` and `COINBASE_API_PRIVATE_KEY`.

## 1. What goes live

**The rule is the paper arm's, "Stablecoin quotes with Euros - 2"** (`coinbasenudge`, `agents/cb_nudge.ts` on
`agents/cb_usdc.ts`' driver). CB-LIVE-RULES (`reviews/2026-10-29-cb-live-rules.md`) found it the rule set to take live as it
runs. In short:

- USDC-GBP alone, PR5's frozen `stepMinute`.
- Bids at fair × (1 − 0.1 / 0.2 / 0.3 %) and asks at fair × (1 + the same), post-only, re-priced when fair moves more than 0.05 %.
- Exits at fair. The 24-hour stop as a taker.
- Fair = 1 (`cb_live`, with the 50 bps de-peg guard) ÷ GBP/USD at second resolution (`cb_fx.ts`), held through FX closures.
  Inside closures it is nudged by Revolut X's USDC-GBP mid.
- The release blackout.

**The executor carries out the arm's decisions and makes none of its own** (`agents/cb_live.ts`). Which arm it follows is a
config word (`cb_live_config.paper`, one of `CB_LIVE_PAPERS`). A better rule is a new paper arm and that word, with no change
to the executor.

**Sizes.** £120 in pounds (`capital_gbp`): six rungs of £20 (`rung_gbp`), three bids from GBP and three asks from USDC.

- A rung's coin is £20 ÷ its price, floored to the product's step: 26.66 USDC at £0.75.
- Coinbase's minimums are far below that: a 0.01 USDC step, a base minimum of about 1 USDC, `min_market_funds` £0.72 (which
  applies to market orders). The probe reads the real ones.
- The paper arm keeps its own $300 record and its own TESTING row. LIVE's row is "Stablecoin quotes USDC/GBP" (`cbLiveRow`).

## 2. How a minute is carried out

Every minute the call `agents?action=cblive` takes the turn's lease `cb-live`. It reconciles, reads, decides and sends:

1. **Reconcile.** Each live order in flight is read back.
   - An order with no venue id (its reply was lost) is looked for in the account's recent orders by its client id. One
     Coinbase shows nowhere stays `pending` and is reported after two minutes. It is never marked rejected on a guess.
   - The fills of every order that filled are read back (`GET …/orders/historical/fills`) and stored by Coinbase's entry id
     (`cb_live_fills`), idempotently.
2. **Positions come from the fills, trip by trip, and are never stored.** A trip is an entry order and every exit and stop sent
   for what it filled.
   - A partial entry fill makes the rung held at once, and its entry is withdrawn.
   - A remainder worth less than £1, or under the product's minimum, is carried rather than exited (CB-LIVE-RULES: 5 of 1,785
     fills): the trip closes and the coin stays in the account.
3. **What each rung should rest.**
   - **A rung not held** quotes the paper rung's entry, at its side and price and at £20. While the paper rung quotes nothing
     (dark, withdrawn, a position of its own, a refused order), it quotes nothing. A paper decision (order id and live minute)
     that Coinbase refused post-only is not sent again until the paper decides anew.
   - **A held rung** exits at `exitTicks` on the paper's fair, re-priced past 0.05 %. Where the book it meets shows that price
     crossing, it rests a tick inside the opposite best, which is better for us.
   - **The 24-hour stop.** After 24 hours the held rung is stopped as an IOC limit within 50 bps of fair (`sor_limit_ioc`, the
     only taker order). One that comes back unfilled is tried again an hour later, with the exit resting meanwhile.
4. **Send.** An order that differs is cancelled and read back final before its replacement goes; one that cannot be confirmed
   freezes its rung and is reported.
   - **Every order is post-only and good-til-date** (`limit_limit_gtd`), ending 20 minutes after it is placed, and re-placed
     when less than 5 are left.
   - **That is the dead-man.** If the executor stops, Coinbase itself takes every order off within 20 minutes; nothing in
     Supabase or the monitor has to work for it.
   - Re-placing loses no fill the rule counts: a resting order fills on a print through its price, which clears every order at
     that price first.
   - Each order is written `pending` before Coinbase is called. A partial unique index refuses a second live order in flight on
     a rung.
5. **Inventory.**
   - A bid needs free GBP and an ask free USDC (Coinbase's `available_balance`, net of holds). One the account cannot cover is
     skipped as an event.
   - When asks are short, an armed account buys the shortfall plus 2 % with a post-only buy at the best bid, within the pounds
     the bids leave and at most £70 a UTC day (`convert_max_gbp_day`). It is good for 30 minutes. There is no conversion at a
     loss, Davies' rule for Revolut X.

**Limits.**

- **Kill switch.** `armed_at` null: live entries are cancelled, exits and stops stay armed.
- **Global pause.** `agent_risk.global_pause` cancels every order, exits included.
- **Daily loss stop.** Realised plus marked over the day's trips at −1 % of £120 (£1.20): no entries for the rest of the UTC day.
- **POST governor.** Entries off at 1,500 a UTC day, stops only at 1,800. CB-LIVE-RULES counted about 211 decisions a day, and
  re-placing before an order's end adds about 600.
- **Stale or dark inputs.** No entries when the paper's newest decided minute is more than seven minutes old (it is normally
  3–4 minutes old when the executor reads it; at five, one lost paper run withdrew every entry, 2026-10-29 20:26), or its fair is
  dark. Exits keep their price.
- **Trading flags.** No entries when the product is `trading_disabled` or `cancel_only`.

**Dry-run** (`dry_run` true, as built) POSTs nothing.

- Its client is built read-only: a POST throws before any request.
- Each order it would send is a row (`state` 'dry'), written when the decision changes.
- The turn's report (`cb_live_state.state.lastReport.would`) says what every rung would rest.
- Every turn that reads the accounts, dry or live, saves the GBP, USDC and EUR it read (`state.balances`, available and
  on hold, 2026-10-29); a turn that cannot read them keeps the last. The page's INVENTORY shows them beside the book's count.
- With the key stored it reads balances and the touch, so the inventory checks and the start conversion are dry-run too.
- `dry_run` does not abandon a live book it already holds: live trips keep their exits and stops.

## 3. The API it relies on (Coinbase's documentation, read 2026-10-29; reference §4 item 67)

- **JWT.** ES256 per request: `kid` the key name, `nonce`, `iss` "cdp", `uri` "METHOD api.coinbase.com/path".
- **Create.** `POST /orders` with `client_order_id`; a reused one returns the existing order. A post-only order that would
  cross is refused `INVALID_LIMIT_PRICE_POST_ONLY`.
- **Read and cancel.** `GET /orders/historical/{id}`; `/orders/historical/batch` (by product and start date); `/fills` (by
  order id); `POST /orders/batch_cancel`.
- **Account and product.** `/accounts`, `/products/USDC-GBP`, `/best_bid_ask`, `/transaction_summary`, `/key_permissions`.

## 4. Risks

- **FX exposure of the USDC.** The asks hold about £60 of USDC, a dollar position. A 1 % GBP/USD move is about £0.60.
  CB-LIVE-RULES priced the asks' GBP/USD spread at £7.2 a year on $150, against £68 expected on £225, and advised no hedge.
- **Coinbase outages and lost replies.**
  - Orders end on their own within 20 minutes.
  - An unknown order stays pending and is reported.
  - A 5xx or a timeout is an unknown, not a rejection.
  - Coinbase errors go to the errors box (`agents.cb_live`).
- **Rate limits.** The executor makes about 10 signed requests a turn. Coinbase's private REST limit (a third-party client
  says 30 a second; CB-LIVE-RULES cites 15) is far above that. A 429 is an error like any other, and the next turn tries
  again.
- **Funding.** £120 of GBP is in the account. Until the start conversion fills, the asks are skipped; the bids quote from
  the start.
- **Fees.** CB-LIVE-RULES assumed 0 % maker and 0.0045 % taker on the stable pair. Each 0.01 % of maker fee costs about
  2 bps a round trip.
  - The probe reads the account's spot tier and warns if its maker fee is above 0. The stable pair may be priced apart.
  - Fees are booked from Coinbase's own fills (`commission`).
- **The key.** It needs view and trade only. One that can transfer is the probe's loud warning. ECDSA and Ed25519 keys both
  sign (ES256, EdDSA); Advanced Trade's acceptance of Ed25519 is confirmed only by the probe.
  - The IP allow-list: Supabase's Edge egress has no fixed address, so an allow-list on the key would refuse it. The probe's
    401 says so if one is set.
- **Not verified against Coinbase.** Every request shape is the documented one, pinned against an in-memory venue
  (`cb_live.test.ts`); none has been sent.
  - The first live minute is the check.
  - Coinbase's minimum GTD duration (`DURATION_TOO_SMALL`) is not documented: if 20 minutes is refused, the first order says so.
- **The page.** LIVE's row shows from the arm or the first live order. It opens no page of its own yet; its record is
  `cb_live_orders`, `cb_live_fills` and `cb_live_events`.

## 5. The dry-run check (read-only SQL, before the go)

```sql
-- It turns every minute and reports no error:
select updated_at, last_error, state->'lastReport'->'would' as would, state->'lastReport'->'events' as events
  from public.cb_live_state where id = 1;
-- What it would send, as the paper decides:
select created_at, leg, rung_side, k, side, price, base_size, state, paper_key from public.cb_live_orders
 order by id desc limit 20;
-- The paper arm it follows is current:
select last_minute from public.cb_nudge_state where id = 1;
```

The `would` prices must be the paper rungs' (`cb_nudge_state.state.books."USDC-GBP".rungs[*].o.ticks` × 0.0001), at about
26–27 USDC a rung. With the key stored, `events` shows `skip_inventory` on the asks and a dry `convert` row: the start
conversion it will make.

## 6. Davies' checklist

1. **The key.** A CDP API key, permissions **View and Trade only (no Transfer)**, on the portfolio holding the £120.
   - **Either algorithm is accepted by the client**: ECDSA (its PEM, signed ES256) or Ed25519 (CDP's default, the base64 secret,
     signed EdDSA). Whether Advanced Trade accepts an Ed25519 key is **the probe's answer** (Coinbase's pages disagree): if the
     probe reads `alg` "EdDSA" and `jwt` "rejected (401)", create an ECDSA key instead.
   - It is stored as `COINBASE_API_KEY_NAME` (the key name) and `COINBASE_API_PRIVATE_KEY` (the PEM or the Ed25519 secret).
   - No IP allow-list.
   - A dedicated portfolio is best. **Never trade by hand in that portfolio**: the executor books only its own fills, but its
     inventory checks read the whole balance.
2. **The probe.** `agents?action=cblive&mode=probe&preview=1` answers `ok: true` with (`preview=1` adds Coinbase's order
   preview of a small post-only buy far under the bid, which places nothing; it is the one POST the probe sends):
   - `secrets.key` "pem-ec" or "ed25519" (never "unknown"), and `jwt` "accepted";
   - `can_transfer` false;
   - GBP about 120;
   - USDC-GBP `online`, not `trading_disabled` or `cancel_only`;
   - a maker fee as he expects;
   - `preview.ok` true: no `errs`, and no 401 or 403. On 2026-10-29 20:54 every live order came back 403 "User is not allowed
     to buy crypto", an account restriction the reads could not show.
3. **The dry-run check** (§5), for at least 30 minutes of a weekday session.
4. **He says go**, in the conversation. Then §7 is run.

## 7. The go and its undo

**Go.** Run once, in the conversation where Davies says go. It must return exactly one row:

```sql
update public.cb_live_config
   set dry_run = false, armed_at = now(), updated_at = now()
 where id = 1 and dry_run and armed_at is null
   and paper = 'coinbasenudge' and rung_gbp = 20 and capital_gbp = 120
   and exists (select 1 from public.cb_live_state s where s.id = 1 and s.updated_at > now() - interval '3 minutes' and s.last_error is null)
   and not exists (select 1 from public.agent_risk r where r.id = 1 and r.global_pause)
returning id, dry_run, armed_at, paper, rung_gbp, capital_gbp;
```

Zero rows means nothing was armed: read §5 for why (a stale or failing turn, the pause, a config that is not the one agreed).

**After the go.** The next turn sends the bids and the start conversion. The asks follow once the USDC is there.

```sql
select created_at, leg, side, price, base_size, state, reason, venue_order_id from public.cb_live_orders where mode = 'live' order by id desc limit 20;
select kind, detail, at from public.cb_live_events order by id desc limit 20;
```

**Undo, in three strengths:**

- **Stop new risk (the kill switch).** Entries are cancelled next turn. Exits and the 24-hour stops still run until what it
  holds is sold.

  ```sql
  update public.cb_live_config set armed_at = null, updated_at = now() where id = 1 returning armed_at;
  ```

- **Back to dry-run.** It also winds the live book down: exits and stops run while it holds anything.

  ```sql
  update public.cb_live_config set armed_at = null, dry_run = true, updated_at = now() where id = 1 returning dry_run, armed_at;
  ```

- **Everything off now.** Cancels every order, exits included, next turn. This pauses PR5 LIVE and every other live path too;
  undo it with `false`.

  ```sql
  update public.agent_risk set global_pause = true where id = 1;
  ```

  If Supabase itself is down, Coinbase's own good-til-date ends take every order off within 20 minutes. Cancelling in
  Coinbase's app is the manual way.

## 8. Files and pins

| file | what |
|---|---|
| `supabase/functions/_shared/coinbase.ts` | The Advanced Trade client: JWT, reads, and orders and cancels on a client built to POST. |
| `supabase/functions/_shared/coinbase.test.ts` | The JWT against an OpenSSL-signed vector, SEC1 PEM import, read-only refusal. |
| `supabase/functions/agents/cb_live_probe.ts`, `.test.ts` | The probe: GETs only, the transfer warning, fees as per cent. |
| `supabase/functions/agents/cb_live.ts` | The executor and LIVE's row reader (`readCbLive`). |
| `supabase/functions/agents/cb_live.test.ts` | See below. |
| `supabase/migrations/0177_cb_live.sql` | Its tables (config dry-run and unarmed, orders, fills, events, state), lock, call and prune. |
| `src/agents/agents.js` (`cbLiveRow`), `src/agents/cb_live_row.test.js` | LIVE's row: none until armed or traded live. |

`cb_live.test.ts` pins:

- Dry-run never POSTs.
- Six GTD post-only orders in Coinbase's shape, and their re-placing.
- A fill becomes an exit at fair, and the trip closes.
- The kill switch and the global pause.
- A post-only refusal is not re-sent.
- A lost reply is adopted by its client id.
- The 24-hour IOC.
- The £1 carry.
- The start conversion.
- The loss stop, the governor, and stale inputs.
- LIVE's row reader.

## 9. Found at the go (2026-10-29)

Armed 20:51:31 UTC on Davies' word; disarmed 20:55:57 (`dry_run` true, `armed_at` null).

- **The dry rows held the rungs.** The dry-run's rows matched the paper's decisions, so the first armed turns kept them as the
  rungs' orders and sent nothing for two turns. Fixed: an order of the other mode is never a rung's or a top-up's. Armed, a dry
  row is withdrawn (reason "armed") and the live order placed in the same turn; back in dry-run, a live entry is cancelled
  ("dry-run") and a live top-up ("disarmed"). Pinned both ways (`cb_live.test.ts`). The main session retired the four rows by
  hand at the time.
- **Coinbase refused every order: 403 PERMISSION_DENIED "User is not allowed to buy crypto".** An account restriction on
  Davies' side, not the code's. The executor had left the four rows `pending` as unknowns. Fixed: a 4xx with Coinbase's body is
  a refusal, `rejected`, its reason "http <status>: <body>", an event; a 401 or 403 stops the turn's placing and is an error
  for the errors box; that paper decision, or a top-up, is not sent again for 15 minutes (`CB_LIVE_DENIED_MS`). A 5xx, a
  timeout or a lost reply stays a pending unknown. The probe's `preview=1` now asks Coinbase first.
- **Staleness.** At 20:26 every dry entry was withdrawn and written again a minute later at the same prices: the paper's 20:25
  run timed out, and its newest minute was 5 min 0.8 s old against a 5-minute limit. Live, that is a cancel and a re-post of
  every order. The limit is now seven minutes: two lost runs.
- **The top-up's day cap counted a refused top-up.** Re-armed 21:45:01 after Davies completed Coinbase's questionnaire, the
  executor bought only 13.37 USDC: the 403-rejected top-up (80.31 at 0.7472, about £60) had been counted against the £70
  cap. It now counts only what Coinbase took: a resting top-up at its size, an ended one at what filled (`convertSpentGbp`).

## 10. It decides for itself: `decide` 'self', and the shadow first (2026-10-30, `0182`)

**On whose word.** Davies, 2026-10-30 ~00:45 UTC: "要做" (do it). The recommendation was that LIVE decide for itself, as the two
Revolut X live executors do (`quotes_live.ts`, whose paper twins are only the comparison), because the follower has four
structural costs:

1. When the paper rung is held and live's is not, live is dark on that rung until the paper exits. A paper post-only refusal
   darkens it too.
2. A lost paper run darkens live.
3. A live-only rule cannot be added without changing the paper arm.
4. The paper runs a $300 record and live £120 at £20 rungs, so their states differ anyway.

**What 'self' is.** `cb_live_config.decide` is 'paper' (the follower, §1–§2, the default) or 'self'. Under 'self', every
minute the executor steps the rule of the arm `paper` names (`coinbasenudge` by default) on its own copy of the rule's state,
kept in `cb_live_state.state.self` (`cbLiveSelfStep` in `cb_live.ts`):

- **The fair** is the paper driver's, built from the driver's own functions in its own order (`cbLiveMinuteFair`).
  - USDC is 1 under the 50 bps de-peg guard (`cbCoinFair`).
  - It is divided by GBP/USD at second resolution, held through closures (`cbRatesAt` with `cbHoldBarAt`).
  - Inside closures it is nudged by Revolut X's USDC-GBP mid (the arm's `fairOf`, its EMA kept in the executor's own copy).
  - It is dark in the release blackout.
  - The driver itself (`runCbUsdcArm`, cb_usdc.ts) is frozen by its pre-registration, so its per-minute steps are composed
    again in `cb_live.ts` rather than exported from it. They are pinned equal minute for minute against the paper arm's own
    run on the same inputs, inside a closure with the nudge applied (`cb_live.test.ts`). A counterfactual without the nudge
    fails that pin.
- **The quotes** come from PR5's frozen `stepMinute`, given no prints.
  - It never fills or refuses a rung there; the venue does both.
  - The rungs the account holds, from live's own fills, are put back idle after every minute. A rung not held quotes the
    rule's entry whatever the paper rung is doing. A held rung's trip closing makes the rung place afresh at the minute's fair,
    as the paper's does after an exit.
- **Its minute** is two whole minutes behind the clock (`CB_LIVE_SELF_LAG_MS`).
  - The fast-rate recorder writes minute t at about t + 58 s, so the minute before would race it.
  - At most 10 minutes are stepped in one turn.
  - The paper arm's newest minute is normally 3–4 minutes old when the follower reads it, so 'self' is one to two minutes
    fresher.
- **Refusals on its own terms.**
  - A post-only refusal (Coinbase's, or the crossing check at the touch) is tried again the next turn, as the rule re-places
    a refused order the next minute. A crossing that lasts is written once.
  - Any other rejection waits for the rule's next decision (a fair move past 0.05 %).
  - A 401/403 waits 15 minutes, as before.
- **It reads nothing of the paper arm's orders or state** (pinned: no select of a `cb_nudge_*` table). The shared inputs are
  read as the paper arm reads them: `agent_quote_inputs`, `cb_quote_inputs`, `fx_ticks` and `agent_book_levels`.
- **Everything else is the follower's, unchanged**: exits at `exitTicks` on the fair with the crossing guard, the 24-hour IOC
  stop, inventory checks, the £70 top-up cap counting only what Coinbase took, GTD 20 minutes, kill switch, pause, lease,
  pending-before-send and the one-per-rung index, reconciliation, positions from fills, balances in the state.
- **Exits and P&L under 'self'** mark at its own fair. An entry resting at the same price is kept across a re-decision, and
  across the switch from 'paper': its price alone is compared, not the paper key.
- **`coinbasehold` has no such rule.** The migration's check refuses 'self' with it.

**The shadow.** While `decide` is 'paper', the same step runs every turn as the shadow.

- Its EMA is seeded once from the paper arm's, so the two start level.
- Each turn writes one row a rung to `cb_live_shadow`, keyed by the turn's minute and kept 14 days. A row holds what 'self'
  would rest (leg, side, price, size, why, whether the touch crossed it, its fair and minute) beside what the follower
  wanted (the same, with the paper's fair and newest minute) and what rested after the turn.
- It moves no order, and its failure is an event (`shadow_error`), never the errors box.
- Landing changes nothing that is sent or would be. This is pinned: the same follower turns, with and without the inputs
  the shadow decides on, give equal orders, venue calls and reports.

**The comparison** (read-only), after a few hours of shadow:

```sql
-- 1. Per rung, the last 6 hours: minutes where 'self' would rest something other than what rested, and why.
with s as (
  select minute, rung_side, k, self_leg, self_price, self_why, self_crosses, paper_leg, paper_why, rested_leg, rested_price,
         case
           when coalesce(self_leg, '-') = coalesce(rested_leg, '-') and coalesce(self_price, -1) = coalesce(rested_price, -1) then 'same'
           when self_leg = 'entry' and self_crosses then 'self would be refused at the touch (retried next turn)'
           when self_leg is not null and rested_leg is null and paper_why in ('rung_held', 'rung_refused', 'no_quote') then 'paper dark: ' || paper_why
           when self_leg is not null and rested_leg is null and paper_why in ('stale', 'dark') then 'paper inputs: ' || paper_why
           when self_leg is not null and rested_leg is null and paper_why = 'refused_before' then 'refusal: the follower holds a refused paper decision'
           when self_leg is not null and rested_leg is null and paper_leg is not null then 'wanted, not resting (inventory, crossing, pending)'
           when self_leg is not null and rested_leg is null then 'follower: ' || paper_why
           when self_leg is null and rested_leg is not null then 'self dark: ' || self_why
           when self_leg <> rested_leg then 'leg'
           else 'price'
         end as why
    from public.cb_live_shadow
   where minute >= now() - interval '6 hours')
select rung_side, k, why, count(*) as minutes,
       round(100.0 * count(*) / sum(count(*)) over (partition by rung_side, k), 1) as pct_of_rung,
       round(avg(abs(self_price - rested_price)) filter (where why = 'price') / 0.0001, 2) as avg_ticks_apart
  from s
 group by rung_side, k, why
 order by rung_side, k, minutes desc;

-- 2. The decisions alone (what each source wanted, before inventory and the venue), the same 6 hours.
select rung_side, k,
       count(*) as minutes,
       count(*) filter (where self_leg is not distinct from paper_leg and self_price is not distinct from paper_price) as same,
       count(*) filter (where self_leg is not null and paper_leg is null) as self_only,
       count(*) filter (where self_leg is null and paper_leg is not null) as paper_only,
       count(*) filter (where self_leg = paper_leg and self_price <> paper_price) as price_differs
  from public.cb_live_shadow
 where minute >= now() - interval '6 hours'
 group by rung_side, k
 order by rung_side, k;

-- 3. The two fairs, a minute apart in age: 'self''s minute and the paper's, and how far apart in bps.
select count(*) as turns,
       round(avg(extract(epoch from (self_minute - paper_minute)) / 60), 2) as self_fresher_min,
       round(avg(abs(self_fair / paper_fair - 1)) * 1e4, 3) as avg_bps_apart,
       round(max(abs(self_fair / paper_fair - 1)) * 1e4, 3) as max_bps_apart
  from public.cb_live_shadow
 where minute >= now() - interval '6 hours' and rung_side = 'bid' and k = 0.001 and self_fair is not null and paper_fair is not null;
```

**The switch** is Davies' word after reading these, in the conversation where he says so:

```sql
update public.cb_live_config set decide = 'self', updated_at = now() where id = 1 and decide = 'paper' returning decide;
```

Its undo is the same statement with the two words swapped. Under 'self' no shadow row is written.

## 11. The take shadow: records only (2026-10-31, `0187`)

Davies, 2026-10-31 ~02:00 UTC, in the message that armed Revolut X LIVE's take and put the Revolut X USDC/GBP executor's take in
shadow: "Coinbase USDC/GBP也做好加开 shadow记录". `cb_live_config.take_mode` is 'off' or 'shadow' ('live' is not allowed: a live
taker entry on Coinbase needs a new migration and his word); `0187` sets it to 'shadow'. The executor stays maker-only. Nothing
is sent, cancelled or promised for it.

- **Which rungs.** Each turn, every rung the decision source ('paper' or 'self') would enter: its entry this turn, or one it
  refused before (a touch through the take's limit is through the entry's price too, so the post-only entry crossed and was
  refused; a take would go on that minute all the same). Every gate of an entry applies first: pause, dark or stale fair, loss
  stop, governor, unarmed.
- **Not in a closure.** No shadow inside PR5-W's FX closures (`inQuoteClosure`, the nudge arm's own scope) or a release blackout
  (`cbInBlackout`), at the turn or at the minute the fair was decided (`cbTakeClosed`). The executor does quote in closures (its
  arm holds the rates, up to 60 hours), so this is the take's rule, not the executor's.
- **The limit** is k + this account's taker fee from the fair the entries are priced on (`cbTakeLimitTicks`). The fee is
  Coinbase's `transaction_summary` for SPOT (`fee_tier.taker_fee_rate`), read once a day and kept in `cb_live_state.state.takeFee`.
  If it cannot be read, no shadow that turn, and a `take_fee_unreadable` event once a reason. Caution: this is the account's
  spot tier, and stable pairs may be priced apart (every maker fill of this executor so far paid 0 commission). Each event
  carries the maker rate beside the taker, so a tier that is not this book's price shows.
- **The depth.** `best_bid_ask` (already read every turn) gives no size. Only when that touch is through a rung's limit, the
  book is read once that turn with the same key (`GET /api/v3/brokerage/product_book`, 50 levels a side, `productBook` in
  `_shared/coinbase.ts`). That read must be through the limit too, with more coin through it than the executor's holding line
  (`cbTakeLine`): a fill under £1 at fair, or under the product's minimum, is carried and never exited (`isDust`). Most minutes
  this costs no call.
- **The record**, a `take_shadow` row of `cb_live_events`: the rung, side, limit, size (the rung's pounds at the limit), the fee
  (taker, maker, tier, when it was read), the funds check (the turn's free balance plus what the rung's resting live entry holds,
  which a take would cancel first; a buy's need includes the fee), the depth and the line, the read (Coinbase's time, best bid
  and ask, the levels and whether the book went deeper than they show) and the turn's touch. The turn's report says how many
  entries it tested, how many the touch was through, how many were shallow, and why none was recorded.
- **Pins** (`cb_live.test.ts`, the take shadow tests): an event through the limit with the orders sent the same as with the
  shadow off; none for a shallow book, a closure, a blackout or an unreadable fee (said once); the book read only when the touch
  is through, the fee once a day; an ask with no USDC says its funds do not cover it. On the code before `0187` all three fail.

Read it (read-only):

```sql
select at, detail->>'rung' as rung, detail->>'limit' as lim, detail->>'base' as base, detail->>'depth' as depth,
       detail->'fee'->>'taker' as taker, detail->>'fundsOk' as funds, detail->>'entryWhy' as why
  from public.cb_live_events where kind = 'take_shadow' and at >= now() - interval '1 day' order by at desc;
```

Its undo: `update public.cb_live_config set take_mode = 'off', updated_at = now() where id = 1;`.
