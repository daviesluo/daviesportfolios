# "Stablecoin quotes USDC/GBP" on Revolut X: the design, the go and its undo (2026-10-29, migration `0180`)

Davies, 2026-10-29 ~22:05 UTC: "…也上线一个revolut x的Stablecoin quotes USDC/GBP 策略，账户api用之前叫你退役的那个trend 4h的api，我把那个账户改为了
120磅你专门拿来做revolut x的usdc盘，可以和revolut x的usdt盘以及coinbase的usdc盘做对比". The rules are RX-USDC's
(`reviews/2026-10-29-rx-usdc-live.md`). Built dry-run and unarmed; it goes live only on Davies' word, in the conversation where he
says go, by the statement in §5.

## 1. What it is

A second instance of PR5's live executor (`agents/quotes_live.ts`, `QUOTE_RXU_INSTANCE`), not a copy: the same code that runs
LIVE's USDT-GBP book carries out the same paper engine's decisions (`agent_quote_state`) on another account.

| | LIVE ("Stablecoin quotes USDT/GBP") | "Stablecoin quotes USDC/GBP" (Revolut X) |
|---|---|---|
| account | PR5's sub-account, key `_2` (`REVX_KEY_NAMES.revx2`) | the retired trend loop's sub-account, `Revolut_X_API_kEY` / `REVOLUT_X_PRIVATE_KEY` (`REVX_KEY_NAMES.revx`) |
| book | USDT-GBP alone since 2026-10-29 22:30 | USDC-GBP alone |
| capital, rungs | £600, six rungs of £100 | £120 in its config; £30 on each 0.1 % and 0.2 % rung a side, the 0.3 % rungs quoting nothing (`weights.k`) |
| exits | at fair, meeting the book | a tick beyond fair (`exitOffset` 1), meeting the book |
| tables, lease | `agent_quote_live_*`, `quotes-live` | `agent_quote_rxu_config`, `_orders`, `_events`, `_state`, `quotes-live-rxu` |
| holding line, weekend | £1; its weekend replica while `weekend_mode` is 'live' | the same line; LIVE's weekend replica (read only) while its own `weekend_mode` is 'live' |
| its asks' first coin | operator conversions, then top-ups of £5 a day | top-ups alone, up to £65 a day, a shortfall bought in part as the pounds allow (`topUps`) |

Everything else is LIVE's, unchanged: the POST governor (900 / 950 a day, its own key), the −1 % daily loss stop, the de-peg and
stale-input guards, the bounded 24-hour stop, the global pause (`agent_risk.global_pause`, shared), the dead-man watch (no
entry while the dead-man's beat is over five minutes old), post-only entries and exits, a 4xx recorded `rejected`, a 5xx or a
lost reply left `pending` for the reconciliation, dry-run rows of their own mode (the open-rung index is per mode, so a dry
row never holds a live rung), and a top-up's pounds counted from what it holds open or filled (a refused one counts nothing).

**Where it runs.** Inside PR5's minute call (`agents?action=quotes`), beside LIVE's turn, in parallel: it needs the minute the
paper engine has just saved, which a call of its own could reach first. That call is a row of `edge_calls` and of the
watchdog already. A fault is one `agents.quotes_rxu` row in the errors box (each hourly while it lasts); the minutes before
`0180` has applied (its tables missing) are no fault.

**The dead-man.** `monitor?action=deadman` runs its dead-man beside PR5's (`RXU_TARGET`, `monitor/deadman.ts`): when its
executor has not finished a turn for three minutes, every resting order on its account is cancelled and read back, recorded in
`agent_quote_rxu_events` and `ops_errors` (`symbol` `rxu`). The Worker keeps no fresh-read memory for it, so a state that
cannot be read is not held: it cancels (PR5's three-minute grace is not given; with nothing armed it lists an empty account).

**The page.** A row of LIVE, "Stablecoin quotes USDC/GBP" on Revolut X (`quotesRxuRow`; Coinbase's USDC/GBP row says Coinbase),
once it has sent a live order or carries its decisions live; its page is LIVE's executor's page on its own book
(`readQuotesRxu`). Its balances as the venue gives them (`venueBalances`, available and on hold) are in its payload.

## 2. Never trade by hand in its account

Its executor books fills and inventory from that account's balance as its own, as LIVE's does in `_2`. Tell Davies so whenever
the subject comes up.

## 3. Before the go: the probe

`agents?action=probe&only=revx` (read-only): the account's balances (GBP about £120 as Davies set it, no USDC, no USDT, no
other coin the executor would count), USDC/GBP's pair configuration (`min_order_size`, `min_order_size_quote`, `base_step`), a
signed call with a query, the active orders on USDC/GBP (none) and the order history's field names. Revolut X's API says
nothing of a key's permissions: the key must be able to trade, and its sub-account holds only what this book should trade.

## 4. Dry run first

From `0180` the executor turns every minute in dry-run: its decisions are rows of `agent_quote_rxu_orders` with mode
`dry_run`, nothing is sent, and its state carries its reasons. Check after a few minutes: `entryBook` 'dry_run', its dry
rows on USDC-GBP's 0.1 % and 0.2 % rungs only, about £30 each, its balances read (state `balances`, `venueBalances`), no
`agents.quotes_rxu` error.

## 5. The go, and its undo (Davies' word only)

The go (outside an FX closure, Friday 21:00 → Sunday 21:00 UTC, as LIVE's weekend switch was turned):

```sql
update public.agent_quote_rxu_config
   set dry_run = false, live_confirmed_at = now(), weekend_mode = 'live', updated_at = now()
 where id = 1 and dry_run and live_confirmed_at is null;
```

From the next turn it rests its bids, finds its asks short of coin and buys it by a maker top-up at the top of the bids; the
asks go out once that fills.

The kill switch (entries withdrawn, exits and stops stay armed):

```sql
update public.agent_quote_rxu_config set live_confirmed_at = null, updated_at = now() where id = 1;
```

Back to dry-run altogether (after its holdings have exited):

```sql
update public.agent_quote_rxu_config set dry_run = true, live_confirmed_at = null, weekend_mode = 'off', updated_at = now() where id = 1;
```

`agent_risk.global_pause` stops everything, LIVE's included, exits too.

## 6. What this cannot show

The replay's figures (RX-USDC) are a backtest on public prints with the live haircut; at £30 a rung the fills a print can give
are larger in share than at LIVE's £100, which the replay counts but no live record has yet confirmed. Its twin, "Stablecoin
quotes USDC/GBP LIVE twin" (`rxu120`), runs the same rules on paper from 2026-10-30 00:00 UTC
(`reviews/2026-10-29-rx-usdc-live-prereg.md`).
