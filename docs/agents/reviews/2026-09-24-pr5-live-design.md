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

**Log.**

* 2026-10-18 05:17 UTC: `take_mode` and `weekend_mode` set to `'shadow'` (bcd3bcaf deployed, `0131` applied). The weekend
  replica started `late`, mid-closure, from PR5's engine as it stood, as designed.
* 2026-10-18 20:20 UTC, the weekend shadow read (05:18 to 20:17 Sunday, the closure's last 900 minutes; read-only SQL):
  1. Targets at `quoteTicks(fair, k)` on the held X: PASS. One X throughout, 1.3329957, the books' last (PR5's last X,
     Friday 23:09). 32 price segments over the 12 rungs: the 18 priced ones placed exactly at `quoteTicks` of that
     minute's fair, and fair never moved over 0.035 % within one, inside the rule's 0.05 % re-price band.
  2. Fair within 50 bps of the last print: PASS, at most 13.3 bps. No guard on any of the 1,802 events.
  3. £10 a rung: PASS, base × price £9.99999 to £10.00001 on every priced target.
  4. Variant-3: no direct comparison. Its weekend rule starts 2026-10-23 21:00 and its tables hold no order yet. The
     replica is its code (`stepTwinPaper` with the weekend rule), and 1 and 5 recompute its prices and fills
     independently: the replica's own paper fill of the USDC bid (07:33:43.603) is the print found below.
  5. Would-be fills covered: PASS. Through a target: USDC ask 0.1 % at 06:53:44 (0.7506–0.7507 against 0.7505) and USDC bid
     0.1 % at 07:33:43 (0.7486 against 0.7489; the paper exit at 0.7502 still rests at 20:17). At the price, never through:
     USDT ask 0.1 % at 0.7495, 12 prints (one of 89.4 coins at 06:03). Each needs £10 or 13.3 coins, which the account
     held. All six bids together need about £60.0, a few pence over its free pounds, so one bid would be skipped for
     funds as on weekdays (37 such skips 10-14 → 10-16), never sent short.
  6. No stale minute: PASS. The replica's minute equals PR5's in every event, and the 900 minutes have no gap.
  7. No error: PASS. `agent_quote_live_wkpaper.last_error` is null, and `ops_errors` has no `agents.quotes*` row since
     05:17 (only `ig.quotes` and `agents.pm_lp`, unrelated).
  8. LIVE unchanged: PASS. No `agent_quote_live_orders` row since 2026-10-16 23:09:29, none open.
  Found: the shadow wrote an event a book every minute (1,802, of which 1,794 repeat the one before), because a jsonb
  detail comes back with its keys reordered and never stringified equal. Fixed with `canonJson` (quotes_live.ts), pinned
  in `quotes_live_switches.test.ts` on a database that reorders keys as jsonb does; the counterfactual writes 2 a minute.
  It never touched an order: 'live' does not run the shadow step.
* 2026-10-18 20:28:05 UTC: `weekend_mode` set to 'live' on Davies' word ("另外live的主动吃单和周末挂单这两个没问题的话就直接live
  也行"), and set back to 'shadow' at 20:28:43. Inside a closure 'live' acts at once (`paperView` follows the replica
  whenever PR5's minute is in a closure), and this weekend's replica was `late`: it was copied at 05:17 Sunday and held a
  paper USDC bid fill that LIVE never had. The executor sent 11 £10 entries (ids 6772–6782) at 20:28:27 and cancelled
  all 11 by 20:29:26 after the revert, 0 filled. Rule from this: `weekend_mode` turns 'live' only outside a closure, so the
  first closure it trades starts with a replica copied in the hour before. It was re-set after 21:00 (the next log line).
* 2026-10-18 21:06:04 UTC: `weekend_mode` 'live' again, outside the closure (PR5's minute 21:04 Sunday). The first closure
  it trades opens Fri 2026-10-23 21:00 UTC, with the replica copied from PR5's engine from 20:00. `take_mode` stays 'shadow'.
* 2026-10-23 18:05 UTC, the take shadow read after five weekdays (10-18 05:17 → 10-23 18:02; read-only SQL, not blind):
  **0 `take_shadow` events.** Fewer than two is not a fail: the shadow runs on, and the next read is 2026-10-30 18:00 UTC,
  counting 10-23's closure (Davies, 10-20).
  1. Matched to a variant-2 take: no event to match. The other way round, variant-2 took twice, both on 10-20's USDT ask:
     k 0.2 % at 12:28:25 (limit 0.7485) and k 0.3 % at 13:59:25 (limit 0.7483). Both filled whole at or through the limit
     and exited at 0.7457 / 0.7458. LIVE wrote nothing because each rung had a frozen cancel: entries 7237 and 7238, cancel
     asked 08:37:26, read back cancelled 15:02:28. A rung with an order in flight places nothing and is not shadowed. At
     13:59 LIVE's stale-input guard also stood (the USD book's newest hour 178 min old); it cleared at 14:00, a minute after
     variant-2's.
     A reconstruction (fair = `fair_u / x` of `agent_quote_minutes`, which gives variant-2's recorded fair; the recorder's
     last read at most 90 s old) finds every other through-limit minute on a rung shut out by name:
     * LIVE holding the rung: 10-20 USDT ask 0.1 %, a 0.147-coin remnant whose exit met a venue 500.
     * A guard: stale USD hour, or de-peg.
     * The paper rung in position: every minute of 10-22 and 10-23.
  2. `fundsOk`: no event.
  3. LIVE as 'off': PASS.
     * 1,527 orders since 05:17, none with `request.take`.
     * Every entry and exit was post-only GTC; the one IOC was a 24-hour stop (7798, 10-22 10:13).
     * `ops_errors` has no `take shadow`, `take:` or "recorded book is unreadable" line.
  4. Would-be fills inside the limit at the read's touch: no event.
  **Switches:** `take_mode` 'shadow', `weekend_mode` 'live' (since 10-18 21:06:04). The weekend replica still holds 10-18's
  late copy; it copies again from 20:00 tonight. **Verdict: keep 'shadow'.**
  **Found beside it:** on 10-20 a cancel stayed frozen for 6 h 25 min (08:37 → 15:02) on six rungs. It would have held a
  live take back too.
  **To watch on the first real take:**
  * It is a taker IOC: not post-only, no post-only check and no fresh read of the touch. Only its limit bounds it, on a
    read up to 90 s old.
  * It cancels the rung's entry first. A frozen cancel, or funds short, idles the rung that turn, where the shadow left the
    maker entry resting. Funds short shows only as a `take:` line in the turn report, with no `skip` event.
  * Each take costs the governor a cancel and an IOC POST.
  * The fee is 0.09 %. A sell pays it in pounds, pennied up (as the stops book theirs). A buy pays it in coin, booked net
    (D4): the exit must sell exactly the net coin and leave no remnant.
  * The entry has no paper order. Check that LIVE's row books its fill, fee and exit at fair, and that the paper rung's
    own fill opens no second entry while LIVE holds.
* 2026-10-30 18:00 UTC, the take shadow read again (10-18 05:17 → 10-30 ~18:00; read-only SQL, not blind):
  **47 `take_shadow` events, all on USDT-GBP's asks, all sells, all at £50 a rung (before the USDT-only switch).** They are
  44 on k 0.2 % (10-28 18:42 → 19:38), 1 on k 0.3 % (10-28 18:52), and 2 on k 0.1 % (10-29 15:22 and 15:28). None has
  happened since LIVE went USDT-only (10-29 22:30), so none was taken under today's rules.
  **They are 2 take opportunities, not 47:**
  * **10-28.** USDT-GBP's book sat about 30 bps over PR5's fair for an hour (fair 0.7488–0.7495; maker ask 0.7518; best
    bid 0.7517). That best bid was one order of 49.91 coins, shrinking to 48.45 by 19:37 under £0.10 sales.
  * **10-29 15:22.** A bid of 647.29 coins at 0.7482 against fair 0.74677.
  * **Why the rows repeat.** A shadow sends nothing, so the rung stays flat and the same test passes the next minute and
    is written again: by design, not a bug (`canonJson` stops only identical details, and `at`/`fair` change). Every row
    has `replaces` null, because the paper rung's own post-only entry crossed the bid and was refused (LIVE 9335, 9352,
    9396…, `rejected`).
  * **What 'live' would have sent: 3 IOCs, not 47.**
    * 10-28 18:42: an IOC on k 0.2 % at 0.7516. It takes the whole 49.78-coin bid at 0.7517 (≈ £37.42; the rest dies, the
      next bid being 0.7505); the rung holds, so no more k 0.2 % takes.
    * 10-28 18:52: an IOC on k 0.3 % at 0.7517 finds that bid gone and dies unfilled (the rung idles that turn).
    * 10-29 15:22: an IOC on k 0.1 % at 0.7482 fills whole (66.83 coins from 647). The rung holds until its exit, so there
      is no 15:28 take; variant-2's exit filled at 15:43.

  **Criteria:**
  1. **Matched by a variant-2 take: PASS on the 3 distinct takes.** Variant-2 (`agent_quote_twin_take50_orders`,
     `request.take`) took at each, with the same book, rung, minute and limit:
     * 10832, 10-28 18:42, k 0.2 %, 0.7516;
     * 10864, 18:52, k 0.3 %, 0.7517;
     * 11518, 10-29 15:22, k 0.1 %, 0.7482.
     The other 44 rows have no variant-2 take. The gap, named: variant-2's take had filled and its rung was held (10832
     until its exit at 0.7494 at 10-29 01:59; 11518 until 15:43), while the shadow holds nothing by design.
     Variant-2's 10864 filled 49.65 coins from the same 49.8-coin bid its 10832 had already taken, because the twin does
     not take its own fills out of the recorded book. Its 10-28 pair is therefore one fill counted twice; LIVE would have
     had one.
  2. **`fundsOk` true: PASS**, 47 of 47 (a sell needs 66.5–66.8 USDT, which the account held).
  3. **LIVE as 'off': PASS.**
     * 3,657 live orders since 05:17 on 10-18, none with `request.take`.
     * Every entry, exit and conversion was post-only GTC (2,975, 665 and 15); the 2 IOCs were 24-hour stops.
     * `ops_errors` has no `take shadow`, `take:` or "recorded book is unreadable" line.
     * RX USDC/GBP's `take_mode` is 'off', and it has no take row.
  4. **Each would-be take inside its limit at the read's touch: PASS.**
     * The read's best bid ≥ the limit on all 47 (0.7517 against 0.7510–0.7517 on 10-28; 0.7482 against 0.7482 on 10-29).
     * Every read was 46–49 s old, inside the 90 s.
     * 10-28's depth was 49.8 coins against 66.5 wanted, so that take fills about three quarters.

  **What changed since Davies' word of 10-18, against the code (`quotes_live.ts`, step 6):**
  * **Size: right.** `takeTurn` sizes by `gbpOf`, the weights' share of `capital_gbp`. Since 10-29 22:30 a USDT rung is £100
    (£600 / 6, not £50), and USDC's rungs (weight 0) are not `allowed`.
  * **Compounding: followed.** It moves `capital_gbp` once a UTC day from 10-31 (`quotes_compound.ts`), and the take's size
    follows it.
  * **Limit: unchanged.** It is `takeLimitTicks(fair, k, side)` = k + 0.09 % from fair, independent of `exitOffset`.
  * **Exit and holding: the same path as any entry.** A filled take is held and exits by step 5, now a tick beyond fair
    (`exitOffset`) and never crossing (`exitTicksOnBook`); its 24-hour stop is the same.
  * **`holdMin` £1:** an IOC that fills £1 or less leaves the rung unheld, and the next minute may send another IOC
    (bounded by the governor).
  * **The rebook (until 11-01 22:30):** an ask take spends free USDT that the rebook's top-ups also count. It is checked
    against `free` before sending, so it can be skipped (a `take:` line), never sent short.
  * **Twin comparison:**
    * Variant-2 (`take50`) is on LIVE's rules for weights, `holdMin`, `exitOffset` and (from 10-31) compounding.
    * It has no `fill: at` (LIVE fills 'at'), so its holding can differ from LIVE's.
    * It has no `weekend` rule. LIVE quotes closures (`weekend_mode` 'live'), and with `take_mode` 'live' it would also take
      inside a closure, where variant-2 is dark and the 10-18 pricing never looked.

  **Verdict: all four criteria pass, on 2 opportunities in 12 days and none yet under today's rules.**
  * Variant-2's replays of them: +£0.0745 (10832, held 7 h 17 min) and +£0.0369 (11518, 21 min) after the 0.09 %, at £50.
  * Recommendation: the switch is ready on Davies' word. Rung size and the rules have changed since his 10-18 word, so
    it is his again.
  * If he wants evidence under today's rules first, keep 'shadow' until one USDT-only event.
  * The statement (one row, the next turn; undo `set take_mode = 'shadow'` or `'off'`):
    `update public.agent_quote_live_config set take_mode = 'live', updated_at = now() where id = 1;`
  * **To watch on the first live take:** the IOC's partial fill, its fee in pounds, the exit a tick beyond fair, and no
    second IOC on the same rung while it holds.
* 2026-10-31, the two risks the 10-30 read left unverified, run against the live executor's own take code
  (`supabase/functions/agents/quotes_live_take_rules.test.ts`). Davies keeps `take_mode` 'shadow' ("按照你推荐的来").
  The tests use LIVE's instance on a simulated account on Thursday 11-05, with every rule in force: USDT-GBP alone at
  £100 a rung, the £1 line, the exit a tick beyond fair. No code changed and no config was touched.
  1. **A partial fill under the £1 line: real, bounded, and the line's own rule. No fix.**
     * A take IOC for the rung's £100 (132.64358 USDT at 0.7539) meets a read 0.6 coins deep. It fills 0.59946 after the
       fee, which is under the line (1.3238 USDT).
     * The rung counts as holding nothing. The next turn, with the book still through, sends the same full-size IOC
       again. A third IOC against a deep read fills whole.
     * So one opportunity gave 3 IOCs. There is never more than one in a turn, and each is sized at the rung's whole
       pounds, not its remainder.
     * The rung then carries 133.72 USDT: its 132.52 plus the partials' 1.20, over its pounds by less than the line. One
       exit (0.7556) sells all of it. No fourth IOC follows while it holds, though the book stays through.
     * Counterfactuals: a read 2 coins deep (over the line) gives one IOC and its exit. The same 0.6 partial without
       `holdMin` is a holding, so one IOC.
     * Shadow on the same reads sends nothing, sends every order exactly as 'off' does, and writes one `take_shadow` a
       minute.
     * Why no fix: this is the 10-29 holding line's rule ("under it the rung's entry keeps resting and its coin is carried
       into the trip"). The maker entries and variant-2 (`take50`) run it the same way.
     * The cost: each sub-£1 fill pays the venue's round-up to the penny (here 0.46 for 0.45234). It is pennies at most,
       because the IOCs stop once the line is passed.
     * If Davies wants a single IOC per opportunity, the change would be a rule change to variant-2's pre-registration as
       well, made with his word and a deviation record. Two options: size a re-take to the rung's remainder, or take only
       when the read's depth through the limit passes the line.
  2. **A rebook's sale against the coin a take bought: not real. Pinned.**
     * The setup: 420 USDT, a rebook running (its weights six hours old), and a 0.1 % bid take that buys 132.5242.
     * The sale sells the 15.75471 surplus over the three asks and the 2 % buffer, at 0.7555. After 30 minutes it is
       cancelled and the same turn sends 15.75471 again, with the take's coin in the account.
     * The same sales go out without the take: `beyond` subtracts the longs and a sale is capped at `free`.
     * The exit is the same order with the rebook on or off, so it is never starved.
     * The open sells never offer more USDT than the account holds, checked on every one of the 35 turns.
     * On 400 USDT the take lifts the account to 532.52 and nothing is sold.
     * Counterfactual: with `beyond` not subtracting the longs, the test fails.
  * **The next step: take stays 'shadow'** until the first take event under USDT-only reads clean against criteria
    (a) to (d). Then Claude proposes the flip to Davies, with the statement above.
* 2026-10-31 ~02:30 UTC, **TAKE-DEPTH: no take through £1 of coin or less, from 2026-10-31 04:00 UTC** (Davies, ~01:30:
  "按照你推荐的来，确保效果最佳，你觉得需要改就改"; `reviews/2026-10-31-take-depth-deviation.md`).
  * What it measured:
    * None of variant-2's 14 takes or LIVE's 47 shadow events had £1 or less through its limit (the least was 48.45 coins).
    * On the recorder's USDT-GBP reads from 10-05 to 10-31, an ask rung's limit had £1 or less through it 132 times, all on
      10-22 between 05:00 and 09:00, while LIVE's asks were holding.
    * Each of the 132, taken, lost to fair: −£0.015 on average, the best −£0.0089. The cause is the venue's penny on the
      fee and on the proceeds.
  * Which option won: (B), depth through the limit over the holding line, alone. (A), sizing a repeat take to the
    remainder, changes nothing on the record and would only buy a carry's worth (under a line) less at a take's edge.
  * Built in the shared take path (`takeDeep`, `readDepthThrough`, `TAKE_DEPTH_FROM`): LIVE's instance (the shadow
    included) and variant-2 take it at the same minute. `take_mode` stays 'shadow'.
  * Pins: `quotes_live_take_rules.test.ts`. From the instant, shallow reads take nothing and the first deep read takes
    once, whole. On 10-30, the counterfactual, the same reads sent three IOCs.
  * The next step is unchanged: the first USDT-only take event that reads clean, then the proposal to Davies.

## Addendum (2026-10-28): the operator's conversion follows the bid

On 10-27 the operator's USDC conversion for the step to £600 (order 8823) rested a tick under a bid that rose past it,
filled nothing in its 24 hours, and LIVE's USDC asks ran short for about 40 hours; the top-ups' £5 a book a day cannot
cover a capital step, and Davies' standing word (10-02) is that coin shortages are handled automatically. From 2026-10-28
00:00 UTC (`QuoteLiveInstance.convertRepeg`, the live account's instance alone) a conversion `quotes-convert` sent that has
rested 30 minutes under a best bid now above its price is cancelled, read back, and what it has not filled goes again at
the top of the bids, under `runQuotesConvert`'s own checks and never for more coin than the asks still lack; the 24 hours
count from the operator's send (`request.firstTs`). Entries, exits, stops, top-ups and every twin are unchanged (pinned:
the six hours against the frozen file with the rule in force, and LIVE's twin and the five `o600*` twins turn for turn with
and without it). Not blind: a change made after reading the live record.

## Addendum (2026-10-28): an exit the book shows crossing rests inside it

Davies, 2026-10-28, on LIVE's exits shown "rejected — not sent: its price crossed the book, which the venue refuses for a
post-only order" (06:33 a USDT-GBP 0.2 % ask's buy-back at 0.7514 against a best ask of 0.7513; 06:35 the 0.1 % at 0.7515;
17:58 the 0.1 % at 0.7509 against 0.7507). Those rows were this executor's own check (2026-10-02: never send a post-only
order the book shows crossing), and the refused-exit wait (`exitMayGo`) then held the rung's next exit until a newer print
not through it. Measured on LIVE's whole record to 2026-10-28 (read-only): 21 exits refused so in 16 turns, 1–3 ticks through
(one at the touch), the rung's next exit sent a median 58 minutes later (mean 94, at most 297); a price one tick inside the
opposite best met a print at or through it a median 9 minutes later (19 of 21 within two hours, 2 not within 12); the
holdings' actual exits filled a median 129 minutes later. 39 entries were refused the same way; they are the paper's own
orders at the paper's prices, one POST per decision, and stay as they are.

From 2026-10-29 00:00 UTC (`QUOTE_LIVE_EXIT_INSIDE_FROM`, every instance; `exitTicksOnBook`) an exit whose rule price the
book it meets shows crossing rests one tick inside the opposite best instead: a buy at the best ask less a tick, a sell at
the best bid plus one. A crossing buy's rule price is at or over the ask, so this is always a better price for us than the
rule's, and it never crosses the book it was read from; the rule's price is kept in the request (`ruleTicks`). It is
re-priced as any exit, when fair moves past the rule's step. An exit the book still shows crossing is a skip in the turn's
report, not a row, and a refused-for-crossing row from before the instant holds nothing back. A real venue refusal is
still a row and still waits. LIVE's twins take it from the same instant (their pre-registrations' deviations). Not blind.

## Addendum (2026-10-29): a fill of £1 or less does not make a rung held

Davies, 2026-10-29: "那你研究下variant-4的结果，如果基本可以肯定效果正面的话，加入实盘live的规则里和所有测试策略包括所有variant里，并且把variant-4删了，
之后的数字都-1". The verdict (`reviews/2026-10-29-holdmin-verdict.md`) found variant-4's £1 holding line basically certain positive
on USDT-GBP and harmless on USDC-GBP. On LIVE's own record since go-live, 149 of 277 USDT-GBP entry fills were under £1 (a print
of the venue's minimum, £0.10, at a rung's price); each made the rung held, withdrew the rest of its entry and sent an exit for a
few pence that lost a penny or two to the venue's whole-penny settlement, 7.5 such trips a day. LIVE's own days replayed with the
line: +0.62 bps of capital a day before the haircut (P(≤ 0) 0.002), never behind on a day.

From 2026-10-29 22:00 UTC (`QUOTE_LIVE_HOLD_MIN_FROM`; `QUOTE_LIVE_INSTANCE.holdMin {gbp: 1}`, PR5-OPT's rule, unchanged) a rung
counts as held only above £1 of coin at fair. Under it the rung's entry keeps resting and its coin is carried into the next trip;
over it one exit takes the whole holding, and once that exit rests the line is the venue's minimum again, so the exit runs to the
end (`pennyExit` and `exitTicksOnBook` as before). The 24-hour stop counts from the fill that crossed £1. Coin under the line has
no exit and no stop of its own: at most £1 a rung, marked in the day's P&L. Before the instant the executor is as it was
(`quotes_live_instance.test.ts` against `quotes_live_frozen.ts`, unchanged). Every running twin takes it from the same instant
(`0176`; the deviation of their pre-registrations, recorded apart in `reviews/2026-10-29-holdmin-deviation.md`). Not blind.

## Addendum (2026-10-29): USDT-GBP alone from 2026-10-30 00:00 UTC, the coin rebooked by maker orders

Davies, 2026-10-29: "…基本可以肯定效果正面的话，把live全换成只做USDT-GBP的（live策略改名为Stablecoin quotes USDT/GBP）…（换币也用挂单不要有转换损失）".
The study (`reviews/2026-10-29-usdt-only.md`): on LIVE's rules with the £1 holding line, USDT-GBP alone beat both books at £600
since 09-01 by +7.1 % a year (P(≤ 0) 0.014), ahead every month since May; book for book USDT-GBP led USDC-GBP by +21 % a year.

From 2026-10-30 00:00 UTC (`QUOTE_LIVE_USDT_ONLY_FROM`) the live account's instance carries PR5-OPT's weights (code unchanged
since `0148`): USDC-GBP 0, USDT-GBP 1. USDT-GBP's six rungs share the capital (£100 each at £600); USDC-GBP quotes no entry, its
resting entries are withdrawn, and a USDC holding still exits and stops. For 72 hours from then the coin is rebooked
(`rebookOn`): a book holding more coin beyond its longs than its asks need and the top-ups' 2 % buffer sells the surplus by one
post-only order at a time at the top of the asks, never under fair rounded up, cancelled after 30 minutes unfilled and sent
again at the book as it then stands (`planDrains`; a surplus under the venue's minimum is carried); the short book's maker
top-ups have the capital, not £5, for their day. No taker order, nothing that crosses, no sale under fair. A sale is an
automatic conversion (`request.auto`, `request.drain`): step 1 cancels it as a top-up, and an operator's conversion and its
re-peg are untouched. The page names LIVE "Stablecoin quotes USDT/GBP" and books a sale out of the coin's lots first in, first
out. Before the instant the executor is as it was (`quotes_live_instance.test.ts` against `quotes_live_frozen.ts`). Every twin on
LIVE's rules takes the same weights at the same instant (`0178`; `reviews/2026-10-29-usdt-only-deviation.md`). Not blind.

**Moved to 2026-10-29 22:30 UTC** (Davies, 21:59 UTC: "现在就生效吧 或者22:00生效"; `0179`, `reviews/2026-10-29-usdt-only-2230-deviation.md`):
`QUOTE_LIVE_USDT_ONLY_FROM` and `QUOTE_LIVE_REBOOK_SINCE` are 22:30, the rebook runs to 2026-11-01 22:30; nothing else changed.

## Addendum (2026-10-29, 23:00): every exit a tick beyond fair from 2026-10-30 00:00 UTC

Davies, 2026-10-29 ~23:00 UTC: "加进 LIVE", on USDT-NO03 (`reviews/2026-10-29-usdt-no03.md`: every exit a tick beyond fair, alone,
+1.49 % a year at £600 on USDT-GBP since 09-01, P(≤ 0) 0.048; out of sample +4.63, P 0.000). `QUOTE_LIVE_INSTANCE.exitOffset =
{ ticks: 1, from: QUOTE_LIVE_EXIT_OFFSET_FROM }` (2026-10-30 00:00 UTC): from the instant every exit, placed or re-priced, rests a
tick beyond the rule's price in the position's favour; the 24-hour stop is not moved; an exit the book shows crossing still rests
one tick inside it (`exitTicksOnBook`, this design's addendum of 2026-10-28). Before the instant nothing changes, and the frozen
executor's comparison runs as before. Every twin on LIVE's rules takes it at the same minute (`0181`); the deviation of the
pre-registrations is `reviews/2026-10-29-live-exit-tick-deviation.md`. Undo: a commit setting `exitOffset` back off the live
instance (no database switch holds it).
