# Coinbase live: "Stablecoin quotes USDC/GBP", the design and the go (CB-LIVE, 2026-10-29)

**Status: built, DRY-RUN and UNARMED.** Nothing is sent to Coinbase until Davies says go in the conversation where the go
statement (§7) is run.

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
- **Stale or dark inputs.** No entries when the paper's newest decided minute is more than five minutes old, or its fair is
  dark. Exits keep their price.
- **Trading flags.** No entries when the product is `trading_disabled` or `cancel_only`.

**Dry-run** (`dry_run` true, as built) POSTs nothing.

- Its client is built read-only: a POST throws before any request.
- Each order it would send is a row (`state` 'dry'), written when the decision changes.
- The turn's report (`cb_live_state.state.lastReport.would`) says what every rung would rest.
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
2. **The probe.** `agents?action=cblive&mode=probe` answers `ok: true` with:
   - `secrets.key` "pem-ec" or "ed25519" (never "unknown"), and `jwt` "accepted";
   - `can_transfer` false;
   - GBP about 120;
   - USDC-GBP `online`, not `trading_disabled` or `cancel_only`;
   - a maker fee as he expects.
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
