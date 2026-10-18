# S3: PR5's GBP stablecoin quotes — what a live version needs, and whether $50 is worth it (2026-09-24)

**Status (2026-09-24, later the same morning): items 1–8 of the build list are built, pinned, and in DRY-RUN.** The code
is `agents/quotes_live.ts` and migration `0052`; reference §4 item 35 has the detail. Davies moved the test capital to
**£50**, in its own Revolut X sub-account. That account holds GBP only, and its key was verified by the probe at
01:43 UTC.
* The executor carries out the paper engine's decisions order for order. Every limit in the table under "What can go
  wrong" is enforced in code and pinned, and each pin fails with its rule removed.
* Item 9, the page, is not built.
* Going live is one statement plus Davies' word, after the dry-run has been watched against the paper engine for at
  least a day. Nothing below is changed by it: the earning figures and the verdict on $50 are this review's.

PR5 runs on paper since 2026-09-23 15:09 UTC (`agents?action=quotes`, `0051`): the frozen rule's 0 % quotes 0.1 / 0.2 /
0.3 % either side of interbank on Revolut X's USDC/GBP and USDT/GBP books, twelve $100 rungs. It has no live path —
`quotes.ts` makes public reads only, by design. Davies wants it live at $50 beside `trend-4h-live`. This is the design:
what a live version would send, hold and earn at $50, what can go wrong and the limit on each, and what must be built.
Everything comes from the frozen simulator and public data; nothing places an order, and the paper engine's own record
was not read (the queries are below).

## Answer first

**NO-GO now, and $50 is not what would make it worth going.**

* **There is nothing to switch on.** A live PR5 is a build: post-only placement, cancel-then-replace, reconciliation by
  client id, venue-side fills, inventory, a kill switch, an order governor and three guards — nine items below.
* **At $50 it earns about two cents a day.** The frozen shape scaled to $50 (twelve $4.17 rungs) made **$0.576 in the
  28 days after the books tightened — $0.021 a day, 15 %/yr on $50** — on 102 round trips, 94 % won, worst trip
  −$0.006. That is about $7.50 a year, and the one-off conversion into GBP, USDC and USDT costs about $0.09, four days
  of it.
* **Its orders do not shrink with its money.** The rule re-prices when fair moves 0.05 %, whatever the rung size: 205
  orders a day on average in the tightened market (busiest 441), exactly as at $1,200 — and 391 a day in the wide market
  that made PR5's money, with 14 days over the venue's 1,000 and one at 1,856.
* **The paper record is nine hours old** and, by the frozen simulator on the same public prints, should hold no round
  trip yet (128 orders, 0 fills since 15:09). The spec's four weeks end 2026-10-21; they can answer "better than cash"
  (about 27 days at the observed variance), not "better than 8 %/yr" (about 93, go-live audit B1).

GO needs all of: the spec's six conditions after four weeks; the build list done and pinned; a separate Revolut X
sub-account and key, probed read-only and funded in GBP, USDC and USDT; and Davies' word, with the first order
confirmed in the conversation.

## What it would send: orders a day against 1,000

The venue's cap is 1,000 `POST /1.0/orders` a day per account (reference §2; cancels are `DELETE`s on the per-minute
budget, not the daily one). A re-price is a cancel plus a new order — the venue has no amend — so every re-price is one
POST. The strategy rows' live bucket is capped at 40 a day (`agent_risk.max_orders_per_day`) and `trend-4h-live` uses a
handful.

From `backtests/pr5_live/pr5_live.json` (the frozen simulator, imported unchanged, on the committed inputs, fresh from
2026-08-26 to 2026-09-23, 28 days — the week after the books tightened):

| configuration | rung | round trips | P&L | per day | %/yr on its capital | orders a day: mean / p90 / max | fills a day |
|---|---|---|---|---|---|---|---|
| frozen, $1,200 (what paper runs) | $100 | 102 | $11.67 | $0.417 | 12.7 % | 205 / 350 / 441 | 3.6 |
| **frozen shape at $50** | $4.17 | 102 | **$0.576** | **$0.021** | **15.0 %** | **205 / 350 / 441** | 3.6 |
| re-price at 0.10 %, $50 | $4.17 | 129 | $0.442 | $0.016 | 11.5 % | 69 / 117 / 157 | 4.6 |
| re-price at 0.20 %, $50 | $4.17 | 182 | $0.377 | $0.013 | 9.8 % | 33 / 57 / 85 | 6.5 |
| one book (USDT/GBP), $50 | $8.33 | 62 | $0.752 | $0.027 | 19.6 % | 101 / 175 / 218 | 2.2 |
| the 0.1 % rung only, $50 | $12.50 | 70 | $0.769 | $0.027 | 20.0 % | 71 / 119 / 148 | 2.5 |

The first row reproduces the committed `posthoc_new_regime.json` exactly (102 trips, $11.6688, 205.0 and 441 orders a
day), which is the check that the import drives the frozen rule. **Only the first two rows are the tested rule.** The
other four are priced for the arithmetic and are descriptive: choosing one of them after seeing this table would be a
new search, and a new search needs its own pre-registration and its own paper run (the go-live audit's B2 variant is
the natural one). None of them changes the verdict: the best is under three cents a day.

**The re-quote policy that fits with room to spare, keeping the tested rule**: the frozen 0.05 % re-price, and a
governor on the live engine that counts its own POSTs per UTC day — at 600 it withdraws the entry quotes for the rest of
the day (withdrawing costs DELETEs only) and keeps exits and stops; at 700 it places nothing but the 24-hour stops. That
leaves at least 300 a day for the strategy rows (which use at most 40). In the 28 tightened days the governor never
binds (the busiest day was 441); in the wide market it would have bound on at least the 14 days that went past 1,000,
which were the days the rule earned most — the governor is a cost there, and the right price for not breaching the cap.

## What it would hold: inventory, and getting it from USD

The frozen shape at $50 needs, before the first order: **six bids' worth of GBP — $25, about £18.89 at 1.3238 — and
three asks' worth each of USDC and USDT — $12.50 each.** At any one time over the 28 days the simulated book held at
most $8.34 of USDC long and $4.17 short (asks filled, holding GBP), and $12.51 of USDT either way — never more than the
rungs, which is the structural cap.

The sub-account holds USD only. **The venue lists what is needed** (public pair list, 2026-09-24 00:12 UTC): USDC/USD,
USDT/USD, USDC/GBP and USDT/GBP, all `active`, minimum 0.1 of the quote currency; it has **no GBP/USD pair and no
USDT/USDC pair**. So:

| conversion | route | cost at the pull's touch |
|---|---|---|
| $12.50 → USDC | buy on USDC/USD at the ask, 9 bps taker | $0.013 |
| $12.50 → USDT | buy on USDT/USD at the ask, 9 bps taker | $0.012 |
| $25 → GBP | buy USDC on USDC/USD, sell it on USDC/GBP — two taker legs | $0.050 |
| | and the USDC/GBP book's gap to interbank: the two USDC books imply $1.32439 per £ against 1.32377 interbank, 4.7 bps dearer | $0.012 |
| **total** | | **about $0.09** — four days of the $50 P&L |

The cheaper route for the GBP is Davies transferring about £19 into the sub-account from his Revolut account (no pair
needed; whether the app funds a Revolut X sub-account in GBP is his to check). USDT via USDT/GBP instead costs more
(its book implied 11 bps over interbank at the pull). The conversions are orders the LOOP places, counted and recorded
— never trades by hand in an account a loop reads.

Minimums are no constraint at $4.17: a rung is about £3.15, 31 times the 0.1 GBP minimum, and in the 28 days none of
the 102 fills at $4.17 came in under it (a fill is capped at 10 % of its minute's printed volume, and those minutes
were rarely under £1).

## What it would earn at $50

On the tightened books (the week of 2026-08-24 onwards), the frozen shape at $50: **3.6 fills a day, $14.61 of fills a
day, $0.021 of P&L a day; 94 % of round trips won, the worst lost $0.006, the largest drawdown $0.006; one taker exit;
a median hold of 43 minutes; 20 of 28 days positive** (the rest are weekends and days with no fill — FX is dark at the
weekend and the rule does not quote). By book and side: USDT/GBP bids $0.237 (34 trips) and asks $0.146 (28); USDC/GBP
bids $0.148 (27) and asks $0.046 (13). It earns 15 %/yr on $50 where $1,200 earns 12.7 %, because a $4.17 rung is
capped by the minute's volume less often than a $100 one — the scale works slightly in its favour, and the dollars are
still negligible.

**The paper engine's first hours, predicted.** On the public prints since the committed inputs end (USDC/GBP 62, USDT/GBP
135 prints from 2026-09-23 00:00 to 09-24 00:12), the USD books' hourly candles and Yahoo's GBP/USD minutes (the paper
loop's own source; against Exness, the tested one, 0.43 bps median and 1.48 p95 apart over 4,224 shared minutes), the
frozen rule started fresh at 15:09 places **128 orders and completes no round trip by 00:00**. What the engine recorded
is four queries away (not run):

    -- P1: the engine's state
    select last_minute, last_error, updated_at from public.agent_quote_state;
    -- P2: per UTC day and book: orders, refusals, withdrawals, fills, exits and stops
    select date_trunc('day', minute) as day, book,
           count(*) filter (where kind = 'order') as orders, count(*) filter (where kind = 'refused') as refused,
           count(*) filter (where kind = 'withdraw') as withdrawn, count(*) filter (where kind = 'fill') as fills,
           count(*) filter (where kind in ('exit', 'stop')) as exits
    from public.agent_quote_events group by 1, 2 order by 1, 2;
    -- P3: round trips, with the prints that proved them
    select book, side, k, t_entry, fill_ts, fill_print_id, entry, qty, t_exit, exit, how, notional_usd, pnl_usd
    from public.agent_quote_trips order by t_entry;
    -- P4: the order book each going-live order met (the post-only evidence)
    select book, minute, side, k, ticks, detail from public.agent_quote_events where kind = 'book' order by minute;

Expected: P2 about 128 orders on 09-23 (the spec allows ±5 % on round trips and ±10 % on P&L; an order count far off
128 is worth a look at the engine's start-up), P3 empty.

## What can go wrong, and the hard limit on each

| risk | how it happens here | hard limit (at $50) |
|---|---|---|
| **a de-peg** | fair is the USD book's 24-hour median, so it lags a de-peg by hours: the bids keep buying the falling coin at yesterday's price | no entry quotes on a book while the USD book's last hourly close is more than 50 bps from its 24-hour median, or the GBP book's last print more than 50 bps from fair (the quotes sit 10–30 bps from it, so a 50 bps gap means fair is stale); the inventory cap below; a 10 % de-peg then costs at most $1.25 |
| **one-sided fills** | the pound or a stablecoin trends and only one side fills | one position per rung and three rungs a side (structural): at most $12.50 of one stablecoin; the 24-hour stop |
| **stuck inventory** | an exit at a fair the market has left; at weekends FX is dark and exits stay at Friday's fair | the 24-hour taker stop, as an IOC bounded at fair ± 50 bps; unfilled, it alerts and stops quoting that book rather than chasing an empty weekend book |
| **a cancel that fails** | a re-price is DELETE then POST; a failed DELETE followed by the POST leaves two orders on one rung | never POST a replacement until the cancel is confirmed (204 and a read-back showing cancelled or filled); a rung whose cancel cannot be confirmed is frozen and reported every minute; reconcile every minute by client id |
| **the order budget** | the 0.05 % re-price fires on every FX move on a volatile day (1,856 once) | the governor: entry quotes withdrawn at 600 POSTs a day, nothing but stops at 700 |
| **a daily loss** | any of the above | stop quoting for the UTC day after −$0.50 (1 % of $50) realised plus marked |
| **stale inputs** | Yahoo or the USD candles stop | no entry quotes when GBP/USD is older than 10 minutes (the rule) or the USD hour older than 2 hours; exits keep their price |
| **unread settlement** | the venue's order fields (B4/D8), a coin fee's precision (D11) and a coin fee taken without being reported (D12, both in the trend review) are unseen | a fill without its fields is not settled and freezes the rung; the settled base is floored to the pair's step and never exceeds what the account holds beyond the rest of the book |
| **account coupling** | one account for both strategies: PR5's conversions spend the trend row's USD, and the trend floor reads the account's balances | a separate Revolut X sub-account and key for PR5 (go-live audit B4.1) |

## The minimum a live path must do — the build list

1. **Placement**: post-only GTC limits with a `client_order_id`, written to a table as `pending` BEFORE the call, as
   the strategy rows do; the venue's post-only refusal is the rule's "refused" state.
2. **Cancel, then replace**: `DELETE /1.0/orders/{id}`, read back, and only then the new POST.
3. **Reconcile by client id every minute**: `/orders/active`, then `/orders/historical`, a match read back through
   `GET /orders/{id}` (and `/orders/fills/{id}`); an order the venue shows nowhere stays pending for a person.
4. **Fills from the venue**, not from the public prints: positions, inventory and P&L from the venue's fills, with the
   print that would have filled the paper order recorded beside it (the implementation shortfall).
5. **Inventory per coin** against the venue's balances each turn; a quote the balance cannot cover is not placed.
6. **Kill switch**: a quotes pause flag and `global_pause`, either of which cancels every resting quote order; plus the
   order governor, the daily loss stop, the de-peg guard and the stale-input guard above.
7. **A read-only probe of the new key**: balances in GBP, USDC and USDT, the two books' pair configuration, a signed
   call with a query, and the active and historical orders' field names.
8. **Pins, with a double no looser than the venue**: `quotes.test.ts`'s golden windows replayed through the live engine
   against a fake venue that refuses crossing post-only orders, returns trimmed quantity strings and a full-precision
   coin fee, takes a coin fee without reporting it, and loses a cancel; a lifecycle test from funding to a 24-hour
   stop; each with its counterfactual.
9. **The page**: live quotes as their own row, never summed with paper.

Then, before the first order: the spec's four weeks passed; a separate sub-account and key, probed; about £19 of GBP
and $12.50 each of USDC and USDT in it (converted by the loop or funded by Davies); and his word in the conversation.

## What needs Davies

* Nothing now: the paper test runs to 2026-10-21 and decides by its spec.
* If he still wants PR5 live after that: a separate Revolut X sub-account and key for it, and its funding in GBP (a
  transfer of about £19 from his Revolut account is cheaper than converting USD on the venue).
* The honest trade: at $50 it is a plumbing test, not an income — the same 205 orders a day earn $0.02 at $50 and $0.42
  at $1,200. Its capacity figures (in the tightened market $1.09 a day at $300 rungs, 11 %/yr; $3.05 at $1,000, 9.3 %)
  are where it might be worth money, and that is a different decision.

## What this cannot show

* The paper engine's own record was not read; P1–P4 are the comparison the spec's "faithful" condition makes.
* 28 days of one regime; the orders-a-day figures of the wide market are PR5's study's, not re-derived here.
* Whether the venue's 1,000 a day is per account or per key is not documented; this assumes one budget shared.
* Conversion costs are one moment's touch.

## Files

* `backtests/pr5_live/pr5_live_design.py` → `pr5_live.json` (imports `docs/agents/scripts/pr5/pr5_sim.py` unchanged;
  pins the committed copy's sha256 `56fbad85…`, the pre-registered file with only its input path changed).
* `backtests/pr5_live/inputs/`: the public prints since 2026-09-23 00:00, the USD books' hourly candles, Yahoo's
  GBP/USD minutes, tickers, books and pair list, pulled 2026-09-24 00:12 UTC (gzipped).

## Addendum (2026-10-09): a buy-back at the venue's minimum buys what its whole penny buys

Davies, 2026-10-09, after the stablecoin quotes review (`2026-10-09-stablecoin-quotes-review.md`, F1), verbatim: "修复
F1，应用所有tablecoin quotes包括live的" (fix F1 on every Stablecoin quotes row, LIVE included). The live executor's exits
are sized to the penny the venue moves (`pennyExit`, since 2026-10-01). A buy-back worth £0.10–£0.11, which a £0.10 print
nibbling a resting ask leaves, could not be trimmed under the venue's minimum and paid the next whole penny for a hair
under it: LIVE's fills 3956, 4245 and 4304 paid £0.0207 that way, a tenth of its realised to 10-09. From this change it
buys what that penny buys (`floorToStep(pennyUp(n) / price)`), and the hair over the holding stays in the account as coin
the asks use. Nothing else about the order path changes; the realistic twins run the same code (their pre-registration's
deviation 3). Not blind: a change made after reading the live record.

## Addendum (2026-10-18): a take and weekend quoting, each behind its own switch, off

Davies, 2026-10-18, answering the stablecoin quotes review (`2026-10-18-stablecoin-quotes-review.md`), verbatim: "live的策略
有主动吃单吗？没有的话你觉得加上会更好吗？会的话就加上，然后加上周末的挂单，一定验证好没问题再推上实盘部署" (does LIVE take? if adding it
would be better, add it, then add weekend quoting; verify it is right before it goes to the live deployment). LIVE did not
take: every order it sent was the paper engine's post-only maker order, and from Friday 21:00 to Sunday 21:00 UTC its rule
was dark. Both are now built into the executor (migration `0131`, `agents/quotes_live.ts`, `agents/quotes_live_weekend.ts`),
each behind a switch of `agent_quote_live_config` that is `'off'` by default and that only Davies turns.

**Priced on LIVE's own record first** (`backtests/livetw/`, `scripts/replay_live.py` on the 2026-10-18 review's data and the
book recorder's reads, at LIVE's £10 a rung; not blind):

| | trades | net | a day | 90 % | P(≤ 0) |
|---|---|---|---|---|---|
| Take, 10-04 16:00 → 10-17, exits filled by a print through | 8 (6 won) | +£0.1296 | +£0.0130 a weekday | 0.0017 – 0.0267 | 0.023 |
| Take, exits filled at a print | 8 (6 won) | +£0.1217 | +£0.0122 a weekday | 0.0013 – 0.0261 | 0.031 |
| Weekend rule, 09-26 → 10-18, through | | £1.455 → £2.678 | +£0.0556 a day | 0.0178 – 0.1049 | 0.000 |
| Weekend rule, at | | £2.126 → £3.834 | +£0.0776 a day | 0.0311 – 0.1324 | 0.000 |

The take's net is after the venue's 0.09 % (a penny up each, £0.08) and after LIVE's own maker trips it would have
displaced (£0.0291); its two losers are variant-2's two of 10-05 (−£0.0074 each), and variant-2's ninth take (10-14 15:09)
fell on a rung LIVE held. By weekend at £10: +£0.77 (09-26/27, before PR5-W's freeze), +£0.26, +£0.18, +£0.01. The replay of
LIVE's own weekdays 10-05 → 10-16 made £0.6763 by the through rule against LIVE's real £0.6067, so LIVE fills about as the
through rule says and the table's first and third rows are the ones to expect. Small sums at £10: the case for both is the
direction and the bands, not the pounds.

**What each switch does** (`take_mode`, `weekend_mode`: `'off'` | `'shadow'` | `'live'`):

* **`take_mode`** carries TAKE's rule as the twins carry it (`reviews/2026-10-03-take-prereg.md`): on a rung that may enter,
  the book recorder's read at most 90 s old is checked against k + 0.09 % from fair; through it, the rung's entry is
  cancelled and read back, and one taker IOC goes at that limit for the rung's pounds, after the funds check. In
  `'shadow'` the same test on the same read writes a `take_shadow` event (the limit, size, side, whether the funds would
  cover it counting what the cancelled entry gives back, the entry it would replace, the read) and sends nothing: the
  paper entry rests as with `'off'`.
* **`weekend_mode`** carries PR5-W's rule (`reviews/2026-10-18-revx-weekend-prereg.md`, variant-3's) inside an FX closure. A
  replica of PR5's engine (`agent_quote_live_wkpaper`) is copied from PR5's engine in the hour before each closure opens and
  stepped inside it on PR5's own stored minutes and prints with a dark minute decided on the book's last X. In `'live'` the
  executor carries out the replica's decisions inside a closure, at fair on the held X, and PR5's engine's outside, as
  before; a replica behind PR5's minute is stale and quotes nothing. In `'shadow'` it writes a `weekend_shadow` event a book
  whenever the six rungs' would-be entries (price, size, holding) or their guards change, and sends nothing.
* Unchanged in every mode: the governor (900/950), the −1 % daily loss stop, the de-peg and stale-input guards, the post-only
  check against the book, the 24-hour stop, the dead-man switch and its watch, `live_confirmed_at` and `global_pause`. The
  function reads the switches as `'off'` until `0131` has run (they deploy separately).

**One deviation from the paper rows, recorded here.** Variant-3's replica runs on from its own state all week; LIVE's is PR5's
engine at each closure's first minute, so its weekend starts from the paper positions LIVE has been mirroring, and the paper
positions it holds at Sunday 21:00 are dropped at the next copy (LIVE's own holdings exit by step 5 whatever the paper holds).

**Verification before either goes live** (the main session runs the statements, each only on Davies' word in the
conversation where he gives it):

1. `update public.agent_quote_live_config set take_mode = 'shadow', updated_at = now() where id = 1;` — **pass after five
   weekdays** if: every `take_shadow` event has a variant-2 take (`agent_quote_twin_take50_orders`, `request.take`) on the
   same book, rung and minute, or the difference is named (LIVE holding the rung, a guard, its funds); every one has
   `fundsOk` true and a limit equal to variant-2's; LIVE's orders and fills in those days are what `'off'` would have sent
   (no take row, no `take shadow` error in the turn reports); and each would-be take, filled at the read's touch, sits inside
   the limit. Fewer than two events in the five days is not a fail: run on until two.
2. `update public.agent_quote_live_config set weekend_mode = 'shadow', updated_at = now() where id = 1;` by Friday 20:00
   UTC — **pass after one closure** if: `agent_quote_live_wkpaper.state.syncedAt` is a minute in the hour before 21:00 and
   `late` is false; through the closure the row's `last_minute` equals PR5's every minute (no stale guard in the events);
   each `weekend_shadow` target sits at `quoteTicks(fair, k)` on the held X, fair within 50 bps of the book's last print,
   size the rung's £10; variant-3's resting entries on the same minutes match them to a tick or the difference is named
   (a position); and the prints over the closure that went through a target add up to fills the account could have
   covered (coin for the asks, GBP for the bids).
3. Only then, each on its own word: `update public.agent_quote_live_config set take_mode = 'live', updated_at = now() where
   id = 1;` and `update public.agent_quote_live_config set weekend_mode = 'live', updated_at = now() where id = 1;`. Watch
   the first take's fill and exit, and the first live closure's entries, fills and Sunday-21:00 hand-back.
4. Undo either at any time: `update public.agent_quote_live_config set take_mode = 'off', weekend_mode = 'off', updated_at =
   now() where id = 1;` (the next turn; open takes and holdings exit as any holding does).

**Risks left open.** A weekend holding carries its coins across Sunday's GBP/USD reopen: a 0.5 % gap on six £10 rungs a book
is about £0.30, inside the £1.20 daily loss stop. The governor counts weekend POSTs the same way. The take sends a taker
IOC, the first non-maker entry LIVE has sent, and pays 0.09 % where its maker entries pay nothing. Not blind: built after
reading LIVE's record.
