# Pre-registration: the realistic twins of PR5's live executor, "Stablecoin quotes" and "Stablecoin quotes variant-1"

Written 2026-10-02 (UTC). Frozen by the commit that adds it, before the twins' first forward turn in production. Any
change after the freeze is a deviation and is reported as one, here, in an addendum, and in the ledger.

## 0. On whose word, and what it replaces

Davies, 2026-10-02 ~19:20 UTC: "testing页的三个Stablecoin quotes策略funded资金全部改成每个币每个side50英镑，目前显示的数据你按比例换算一下，
这样显示更清楚一些，并且把所有已知的live遇到的不同点和问题全部在这几个testing策略上改动，确保一致，确保真实，不然测试的都是有问题的策略有什么用？
如果你觉得必要的话把这三个testings重新上线，目前的转到在后台继续". On the sizes, ~19:40 UTC: "这里你理解错了 我的意思就是每档50磅，
这样吧你改成原版每档100磅，variant-2 每档50磅，一定要确保新架构真实". On the conversions, ~19:45 UTC: "都按我们昨天新设立的maker费来换币".
On the names: "这个variant-2上线testing后改名为variant-1". The session that ran the work decided, through its coordinator,
to relaunch two of the three rows as realistic twins and to take the third (PR5V) off the page.

The three paper tests that were TESTING's stablecoin rows leave the page and keep running, unchanged, with their frozen
readings: PR5's paper test (`quotes.ts`, verdict 2026-10-21, `2026-09-23-pr5-paper-test-spec.md`), PR5V
(`quotes_variant.ts`, reading 2026-10-28, `2026-09-28-pr5-variant-prereg.md`) and rule D (`quotes_ruled.ts`, reading
2026-10-28, `2026-09-28-pr5-rule-d-prereg.md`). Nothing in this file changes their engines, tables, calls, records or
readings. PR5-R, QUEUE and PR5-W are untouched too.

**The names.** On the page, "Stablecoin quotes" is the twin of PR5's rule, and "Stablecoin quotes variant-1" is the
twin of rule D's judged arm `d` (rule D's own pre-registration calls rule D "variant-2"; PR5V, which was
"variant-1", is off the page). A later stablecoin variant takes the next free number on the page. The frozen engines
keep their documented names.

## 1. What a twin is

A twin is PR5's live executor: `quotes_live.ts`'s own `runQuotesLive` and `runQuotesConvert`, run as an instance
(`QuoteLiveInstance`) on tables of the twin's own, through the live client's own `revxVenue`, against a simulated
Revolut X account (`revx_sim.ts`) instead of the venue. Every rule the live executor has (penny sizing, the exit trimmed
to the penny, a refused exit waiting for a newer print, the crossing check before a POST, a cancel read back twice, the
governor, the 1 % daily loss stop, the 24-hour stop, the de-peg and stale-input guards, the automatic maker top-ups) is
the twin's by construction, and so is any rule the live executor gains later: the executor is not frozen here. The live
account's default instance is the code that ran it before this change, byte for byte in behaviour:
`quotes_live_frozen.ts` (sha256 60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52, the file as of
commit 8acbcead) runs beside today's default instance over six simulated hours in `quotes_live_instance.test.ts`, and
every table, the account's whole state and every report are equal after every turn (fills in part and whole, exits and
their re-prices, refusals at the book, a top-up, a maker and a taker conversion, the stale-input and de-peg guards, a
24-hour stop, the governor closing entries, the global pause and a stretch unarmed). Two perturbations of the default
instance fail it (the exit re-price doubled; a governed key a book in place of one); a third, the exit re-price at 0.9
times, is under that tape's resolution and passes.

| | "Stablecoin quotes" (`pr5`) | "Stablecoin quotes variant-1" (`d`) |
|---|---|---|
| decisions of | PR5's paper engine (`stepMinute`, `quotes.ts`) | rule D's arm `d` (`stepVariantMinute` with `RULED_ARMS.d`, `quotes_ruled.ts`) |
| rungs | 0.1, 0.2, 0.3 % a side of each book: 12 | 0.03, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3 % a side of each book: 36 |
| capital | £1,200: £100 a rung (£600 for the bids, £300 of each coin for its asks) | £1,800: £50 a rung (£900 for the bids, £450 of each coin) |
| governed keys | one (the account), 900 / 950 POSTs a day | four, a book and a side each, 900 / 950 each |
| daily loss stop | 1 % of capital, £12 | £18 |
| from | 2026-09-23 15:09 UTC (PR5's first decided minute) | 2026-09-28 00:00 UTC (rule D's start) |

Sizes come from the live code's own `rungGbp` (capital ÷ books ÷ sides ÷ rungs) and `rungBase`/`pennyExit`. Rule D's
frozen design has four funded sub-accounts; the twin is one simulated account with four governor counters, so a pound
one book's bids leave idle is the other book's to use. That is the one way its account differs from the design's.

**What each twin carries out.** It steps a replica of its engine itself, from the inputs that engine decides on (PR5's
stored minute records, `agent_quote_minutes`: the X and fair each minute was decided on, and the stored prints), at
PR5's own timing: rule D's own call decides each minute a minute after PR5's, so following rule D's stored state would
put every decision a minute late and the stale-input guard would refuse every entry. Where PR5 kept no record of a
minute (before 2026-09-25 00:05) the replica rebuilds its inputs from the stored series with PR5's own functions. The
replica is checked against each engine's own record of the minutes that engine decided: PR5's every event; rule D's
order, refusal and withdrawal events only (its pre-registration allows no read of its results before its reading).
Over the backfill: PR5's replica decided 3,751 events against the engine's 3,739, with 46 differences (29 replica-only,
17 engine-only), all between 2026-09-23 21:48 and 2026-09-24 18:13, where the minute records did not exist and the
inputs were rebuilt; identical from then on. Rule D's: 11,094 events, no difference.

## 2. The simulated account's rules (`revx_sim.ts`)

Each is pinned in `revx_sim.test.ts` with figures worked out by hand, and each pin fails without its rule (the
counterfactual named beside it; every one was run on 2026-10-02 and failed 2 to 6 of the 12 pins of `revx_sim.test.ts`
and `quotes_twin.test.ts`).

1. **Fills.** A resting order fills only on a public print strictly through its price, by the print's own base
   quantity: min(what remains, the summed quantity of the prints through it), print by print in time order. The orders
   a print goes through share it, the best price first, then the earlier order. A print at the order's price fills
   nothing: where it stood in that price's queue is unknown (QUEUE measures it). An order fills only from prints after
   it reached the venue, and not after its cancel landed. Hand pin: a 132-coin bid with prints of 20 and 30 through it
   fills 50, and one at its price fills 0. (Counterfactuals: a print at the price fills; a print through fills the
   whole order.)
2. **Money**, as PR5's live fills 1154–1314 showed it: the pounds move in whole pennies on an order's whole notional so
   far, a sell's credit floored and a buy's debit rounded up; the reply's `filled_amount` is that amount and its average
   price that amount over the coins at the price step. A maker pays 0 %. A taker pays 0.09 %: a buy in the coin, rounded
   up to the base step; a sell in pounds, rounded up to the penny. (Counterfactuals: exact pounds; a taker buy's fee in
   pounds.)
3. **Holds and refusals.** A resting buy holds its pounds rounded up to the penny, a sell its coin; an order the account
   cannot cover is refused 422 in the venue's words ("Not enough funds! Wanted £0.16 but has only £0.15"). A post-only
   order that would cross the book is taken and then rejected, `post_only_immediate_match`. (Counterfactuals: the exact
   notional held; no post-only refusal.)
4. **The book an order meets**: PR5's stored snapshot of that minute's public book (`agent_quote_events`, kind `book`)
   where there is one; else the touch the last print implies, a tick wide on the side the aggressor did not take (a
   buyer at P: ask P, bid P − 1 tick; a seller at P: bid P, ask P + 1 tick), of unknown depth.
5. **A marketable IOC** (the 24-hour stop; in the validation below, the live account's go-live conversions) walks that
   book's levels to its limit and fills what they hold; the rest is cancelled. With only the implied touch, it fills
   there whole. (Counterfactual: it fills whole at the best level.)
6. **A cancel** lands a read after its 204, or a second after it was asked (PR5's first live hour). (Counterfactual:
   it lands at once.)
7. **The dead-man** (`monitor/deadman.ts`, live since 2026-10-02 19:06): when a twin's previous turn is more than three
   minutes older than a print, every resting order is cancelled at that turn + 3 minutes, and no later print fills it;
   a `deadman` event says so. (Counterfactual: it cancels nothing.)
8. **Nothing reaches a network.** The account answers from memory, refuses every host but the venue's and every route
   it does not know, and holds no key: the live client signs with a key generated for the call, never a Revolut X key
   (pinned in both test files: no fetch is made).

## 3. Time, turns and outages (`quotes_twin.ts`)

A twin acts once a call, as the live executor acts once a minute: its turn stands at the instant PR5's call last read
the prints (`fetchedTo`, about 25 s into the minute), after every print up to that instant has been applied in time
order; the venue's clock stands at the turn's instant for the whole turn. One call a minute,
`agents?action=quotestwins` (0087), waits until 38 s into its minute and runs both twins under one lease; a run before
PR5's call has read new prints does nothing. A twin that misses turns does not act in them, and the dead-man applies.

While catching up (from a backfill's end to the present), a call runs one turn in each minute PR5's call ran, each at
:25: the minutes of its beats in `edge_call_beats` from 2026-10-01 16:25, and every minute before (its runs were not
kept). The replica then stands where PR5's engine stood when its call of that minute had run: the last minute it had
recorded by the end of it (`recorded_at`; the median lag is 86.8 s). The database stall of 2026-10-02 is an outage: the
executor finished no turn from 12:16 to 14:12 (its call began at 12:22, 12:36, 13:05 and 13:09 and recorded nothing
past 12:21 until 14:13:29), so no twin turn stands in 12:17–14:12 (`QUOTES_NO_TURN`), and the dead-man cancelled the
twins' resting orders at 12:19:25 (11 of PR5's twin, 33 of rule D's).

## 4. Conversions, as the operator makes them

The asks' coin is bought through `runQuotesConvert`'s default, as the operator buys it since 2026-10-02: a post-only
buy resting at the top of the bids (`makerBuyTicks`), 0 %, at most a quarter of the capital per conversion
(`QUOTE_LIVE_CONVERT_MAX_FRACTION`): £300 of each coin for PR5's twin and £450 for rule D's, one conversion each, sent
two and one seconds before the twin's first turn so that turn places the bids from the pounds they leave. A conversion
fills only by the prints through it (rule 1), so **an ask has no coin until its conversion fills**, and the page says
so while one rests. The executor cancels a conversion unfilled after 24 hours (its own rule); when it does, or the venue
refuses one, the operator sends another for what the asks still lack (the shortfall `runQuotesConvert` reports, at the
maker price it would rest at, at most a quarter of the capital), and none once a conversion has filled whole or the
asks lack nothing. After that the executor's own automatic top-ups keep the asks' coin, as the live account's. The live
account's go-live conversions were taker IOCs (2026-10-01 16:31–16:32); the twins' are makers, on Davies' word.

## 5. Sizes on the page

The page shows each twin as the live executor's LIVE row and page show the live account, in pounds: funded £1,200 and
£1,800, deployed every pound at work (the coins at the index price and the pounds in resting buys), today the loss
stop's figure, unrealised on the coins' cost, realised with its fees. Its page is the live page (BOOKS, INVENTORY, DAYS,
ROUND TRIPS, EXIT ORDERS, ENTRY ORDERS), PAPER, with one line for what it is and one for each book whose asks wait for
their coin. TESTING's scoreboard and its Revolut X card add the twins in dollars at the books' rate, as LIVE adds the
live account. The page reads a twin's orders that filled or rest; its DAYS' order counts are the twin's own tally of
the orders it sent each UTC day.

## 6. The backfill

Each twin's record from its engine's first minute to **2026-10-02 21:05:00 UTC** was computed by this code in the
in-memory database that holds the schema's own checks, by `docs/agents/backtests/twins/scripts/backfill.ts`, on PR5's
stored record read on 2026-10-02 at 21:08:45 UTC (prints, inputs, minute records with their `recorded_at`, PR5's
events, rule D's arm-d order/refusal/withdrawal events, PR5's call's beats; every row before 21:08:00), committed as
`docs/agents/backtests/twins/inputs/twins_inputs.json.gz`. The order ids are numbered, so a run writes the same bytes.

| | turns | orders | events | file | sha256 |
|---|---|---|---|---|---|
| `pr5` | 13,198 (2026-09-23 15:10:25 → 2026-10-02 21:05:25) | 3,077 | 496 | `pr5.json.gz` | f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98 |
| `d` | 6,907 (2026-09-28 00:01:25 → 2026-10-02 21:05:25) | 9,588 | 186 | `d.json.gz` | ecbec6c51dc34d1ae6d2e7b80dafa03194e3296600d460ac3fa1692b04bb9392 |

Inputs: `twins_inputs.json.gz`, sha256 f9ff04901d1b787d55401dac49d7d9be2e6d6b30d997a1ce856cea165e8dffa3. The production
call's first runs load the files from the repository's `main`, one file a call and nothing else in that call, each
checked against the sha256 `TWIN_BACKFILLS` pins; then each twin catches up turn by turn from 21:05:25 to the present,
as in §3 (at most 12 s of turns a call, so a call ends inside its minute), before it turns forward. A second build of
both files on the final code wrote the same bytes.

## 7. The simulated account against the live record

Before this freeze the live instance's own decisions were run through the simulated account from 2026-10-01 16:29:53
to 2026-10-02 21:05:25 at the live's own size (£10 a rung, £120, its starting £120.33), its own two conversions at
their own instants (taker IOCs, fee in the coin), and the dead-man from 19:06, and its fills compared with
`agent_quote_live_orders` (mode `live`), fill by fill: **23 live fills, 23 simulated; 14 matched, 9 live-only, 9
simulation-only.**

- Matched: both conversions (USDT's identical to the coin and the penny; USDC's 39.56 coins against 39.55, the book read
  in its minute), nine entries and three exits; one entry of 13.24 coins filled 6.78 in the simulation, as much as
  traded through it.
- Live-only: six fills at the order's own price with no print through it (the rule: a print at the price fills
  nothing), one exit of a trip the simulation did not have for that reason, and two of the live account's top-ups of
  2026-10-02 18:05 and 18:58 (the simulation ran today's executor from the start, with its top-ups at 06:07 and 14:43).
- Simulation-only: those two top-ups, the exits that rested on at a re-priced level and filled later through it where
  the live exits had filled at their price, and one ask trip the simulation's earlier coin made possible.
- Realised, by the page's own functions (`liveRungs`, `liveBookGbp`): live −£0.0358, simulation −£0.0118, each with one
  USDT ask holding.

Every difference is the fill rule (the simulation counts no fill at the order's own price) or code the live account did
not yet run; no simulation bug was found. The rule is conservative by design: it undercounts the fills a queue at the
touch would get, which QUEUE measures, and the readout says so.

## 8. What the backfill shows (PR5's twin may be read; rule D's may not)

**PR5's twin**, per rung, to 2026-10-02 21:05:25, beside PR5's paper trips to 21:05 ($100 a rung, in dollars):

| rung | twin: trips · won · realised | paper: trips · won · P&L |
|---|---|---|
| USDC bid 0.1 % | 8 · 8 · +£0.9896 | 14 · 14 · +$1.5545 |
| USDC bid 0.2 % | 3 · 3 · +£0.6258 | 4 · 4 · +$0.6423 |
| USDC bid 0.3 % | 0 | 0 |
| USDC ask 0.1 % | 1 · 0 · −£0.0397 | 2 · 2 · +$0.1455 |
| USDC ask 0.2 % | 1 · 1 · +£0.0450 | 1 · 1 · +$0.1190 |
| USDC ask 0.3 % | 0 | 0 |
| USDT bid 0.1 % | 11 · 9 · +£0.5410 | 12 · 10 · +$0.8257 |
| USDT bid 0.2 % | 8 · 8 · +£1.4263 | 9 · 9 · +$1.8731 |
| USDT bid 0.3 % | 5 · 5 · +£1.5556 | 7 · 7 · +$1.8996 |
| USDT ask 0.1 % | 8 · 8 · +£0.5467 (one short of 132.42 USDT open) | 10 · 10 · +$0.6313 |
| USDT ask 0.2 % | 2 · 2 · +£0.3573 | 2 · 2 · +$0.3439 |
| USDT ask 0.3 % | 0 | 0 |
| all | 47 · 44 · +£6.0476, fees £0 | 61 · 59 · +$8.0348 |

Its conversions: USDC's £300 rested at 0.7535 and never filled (the book rose); cancelled after 24 hours, the operator's
£299.32 at 0.7566 filled 2026-09-24 16:39. USDT's £300 at 0.7538 filled 268.5 of 398 coins in six minutes and no more;
its £96.80 for the rest filled 2026-09-26 06:45. Two top-ups of about £5 followed. 3,077 orders, 3,037 sent, at most 673
a day.

Trip by trip against PR5's paper trips: 45 matched; 16 paper-only: the twin's rung still held (its exit still filling
by the prints through it, 3; an earlier trip still open, its exit refused at the touch the last print implied and
re-priced, 3), not enough free GBP for the bid (5: with the capital exactly twelve rungs, top-ups and penny rounding
left the bids' pounds under £600), its ask without coin (1: USDT's conversion part-filled), its entry at the paper's
price but no print strictly through it (3), its entry re-priced at a different turn (1); 2 twin-only: a print went
through the twin's order in the minute between the paper's re-price and the twin's turn, as the live account's #1184
did on 2026-10-01.

**Rule D's twin**, structurally only (no fill, price, trip or P&L of it was read for this, its no-peek): 6,907 turns;
7,505 entries, each the order of an arm-`d` event at the same book, side, rung, price and minute, none without; at most
716 POSTs a key a day; at most one open order a rung; its two operator conversions sent and neither sent again, three
top-ups; the dead-man once; replica 11,094 events, no difference; its tally of orders sent equal to its rows, 9,165.

## 9. What is read, and when

Nothing is decided by the twins. They measure what the live executor would have done at these sizes with these fill
and money rules; the decisions stay where they were, PR5's paper verdict on 2026-10-21 and rule D's reading on
2026-10-28, under their own files, unchanged. **No pass or fail bar is set here**, because none is needed for a
measurement that decides nothing; a bar set later would be a new pre-registration.

- **2026-10-21, beside PR5's verdict**: PR5's twin's readout, per rung as in §8 (trips, won, realised, fees, what it
  holds), from its first turn to 2026-10-21 00:00 UTC, beside PR5's paper trips over the same span; and, for each
  paper-only and twin-only trip, its reason in §8's words.
- **2026-10-28, after rule D's reading is written**: rule D's twin's readout in the same shape, beside arm `d`'s trips.
  Not before: its figures on the page are Davies', not an input to rule D's reading.
- **Every day until then**, read for the run's health only: the replica check (a difference beyond §1's is a fault to
  fix and to report), the calls' beats, the twins' `last_error`, and no row of theirs in `agent_quote_live_orders`.

## 10. Deviations and disclosures before the freeze

- While the backfills were being built, one figure of rule D's twin's P&L was seen: the day's P&L in its executor's
  report of its last turn, in a run of an earlier version (taker conversions), in the tail of the run's log; and a count
  of that run's filled orders was printed while checking file sizes. Nothing else of its fills, prices, trips or P&L was
  read. The builder now prints none of it.
- The live account's validation (§7) read its own record, as the live page does.
- The twins' first turns stand at their engines' first minutes; the live account's conversions were sent after its
  first turn, by hand: the twins' come two and one seconds before it (its second conversion then needed £0.20 more than
  its capital beside six resting bids, `2026-10-01-pr5-live-go.md`).

## 11. Frozen files

| file | sha256 |
|---|---|
| `supabase/functions/agents/revx_sim.ts` | 885def181e01899095745c7c1128a3dee06e11f960965ec439cc7a50642fcd48 |
| `supabase/functions/agents/quotes_twin.ts` | 921ce33adc6d38274bd9c8de7909a2100ff55fdb2d50388e140379af2c578fc3 |
| `supabase/migrations/0087_quote_twins.sql` | 5261f03114a361ead13343e29e92abd373d2343218889858f7b3234107ec6a98 |

`quotes_live.ts` is not frozen: it is the live executor, and a change to it is a change to both. A change to a frozen
file is a deviation (its tests pin these hashes, `src/twins_prereg.test.js`). The backfills and their inputs are §6's.

## 12. Deviation 1 (2026-10-03): the twins become rows, a third twin, and rule D's twin renamed "variant-3"

**Why.** Three things the same day. (1) The size study (reference §4 item 51, its addendum of 2026-10-03;
`docs/agents/backtests/twins/size/`) proposed PR5's rule on its twin at £50 a rung, £600: the size effect measured forward,
and PR5's rule at rule D's rung size. Davies has given standing approval to launch the variants a study recommends; it
is frozen in a pre-registration of its own, `2026-10-03-pr5-size-twin-prereg.md`. (2) Its name, and rule D's twin's,
Davies: "你目前正在做的variant改名为variant-1排上面，这个新的是variant-2，原来的variant-1改名为variant-3". So the new twin is
"Stablecoin quotes variant-1", listed first among the variants; rule D's twin, "Stablecoin quotes variant-1" since §0, is
"Stablecoin quotes variant-3", listed last; "variant-2" is kept for a later twin, not made here. (3) How a variant is
made, Davies: "你说的这四点建议全做": a variant that differs only in its parameters is a row of a table and its tables, not
code. And on the page, "把变体改成数据只是针对后台吧？我前端看到的不影响吧？": the change is the back end's, and the page reads
as before but for the new row and page and rule D's twin's name. All of it changed this document's frozen `quotes_twin.ts`.

**What changed in `quotes_twin.ts`, exactly.**

1. The twins are rows of `agent_quote_twin_specs` (migration 0088): id, page name and order, engine, capital, governed
   keys, start, tables and lease (each named by the id, the table's checks hold them to it), rule extensions, backfill,
   pre-registration, migration, enabled. `specFromRow` builds a twin's spec from its row; a row's rungs and exit re-price
   are its engine's (the executor carries out that engine's rung decisions), and a row naming an engine, keys or a rule
   extension the code does not have is refused and runs nowhere. `TWIN_SPEC_ROWS` holds 0088's three rows (pr5, p50, d);
   `TWINS` and `TWIN_IDS` are built from them, and `TWIN_BACKFILLS` became each row's `backfill`. 0088's
   `create_quote_twin_tables` makes a twin's six tables with 0087's own statement, word for word.
2. The call reads the table's enabled rows in their order each time (`twinSpecs`); before 0088 has applied it runs the
   two twins 0087 made, as before. The page reads the same rows.
3. p50 is the second row: PR5's twin's spec but for its id, its page name, its tables and lease, its migration and its
   capital, £600; its record to 2026-10-02 21:05 UTC is `p50.json.gz`. d's row names it "Stablecoin quotes variant-3".
4. The call, as the first draft of this deviation already had it. A twin with no record yet still loads its backfill
   alone, one file a call and no turn of its own in that call; the twins whose records are whole now take their turns in
   that call too. As frozen, the call ended after the load, so adding a twin would have cost the pr5 and d twins the turn
   of that minute. A twin whose own record cannot be read (before its migration has applied) is set apart for the call
   with its error reported, where before the whole call failed and no twin turned; and one twin's part that throws no
   longer stops the twins after it.
5. Comments.

**What did not change.** pr5's and d's specs, field by field but d's page name (`quotes_twin.test.ts` pins them to their
values as frozen, the key function by its answer for every book and side); their backfills (each its row's now, the
same file, sha256 and minute as §6; `pr5.json.gz` was built again on the final code, its spec read from 0088's row, and is
the same bytes, f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98; `d.json.gz` was not rebuilt, rule D's
twin not being run, §9); their tables, leases, rows and records; every rule of a turn; `revx_sim.ts`; `0087`. A call in
which no twin loads and every twin's record reads does exactly what it did. The test "a twin added later costs the
running ones nothing" runs PR5's twin alone, and beside a twin added at its sixth minute (its tables there; and missing
until its eighth), and finds PR5's twin's orders and turns equal minute by minute; on the code as frozen it fails at that
sixth minute (the turn of the loading call missed, then the missing table throwing the call). The page: its code is
unchanged, and the bundle rebuilt for two comments is main's in every statement of every chunk but its build stamp; the
browser test's twin checks run over the fixture's rows, which `docs/agents/backtests/twins/scripts/fixture.ts` makes from
the spec rows (pr5's row in it is main's to the byte, d's differs by its name alone).

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | f14ecee87da252b9135dbeebcdcfd1dfa3f33c4a945c7b5b830cc2c37a61d7a8 |

§11 keeps the hash the file was frozen at; this is the file from this deviation on. `src/twins_prereg.test.js` pins both.

## 13. Deviation 2 (2026-10-03): TAKE's twin, "Stablecoin quotes variant-2"

**Why.** TAKE's forward test (`2026-10-03-take-prereg.md`, reference §4 item 52; Davies: "可以 批准研究后上线测试…你决定吧")
is variant-1's twin with a taker entry from 2026-10-05 00:00 UTC, its row `0089`'s (`take50`). Its build spec needs code
in two of this document's frozen files: the simulated account fills a take against the book recorder's read after its
instant, and the driver gives a turn that may take those reads and waits for them.

**What changed in `revx_sim.ts`.** One rule, for takes alone: an IOC the executor wrote as a take (`request.take`; the
driver hands its client id to `markTake` from the order row written before the POST) walks the recorder's first read
after its instant (`takeRead`), less what earlier takes took from that same read (study.py's `taken`), in place of the
book the turn met; with no such read nothing fills. Its fee and pennies are any taker's. An order that is not a take
meets the book as before; the account's state gains a field (`taken`) only when a take fills, an order its `take` flag
only when it is one.

**What changed in `quotes_twin.ts`.** `TWIN_RULES` has its first rule, `take` (`{ "from": "<UTC>" }`), which sets the
instance's `take`; a row whose rule settings cannot be read is refused with why. A turn at or after a twin's `take.from`
reads each book's last recorded read at or before it and its first after it (`takeReadsAt`), hands the executor the first
(`takeBookRow`: seen at most 90 s before the turn) and the account the second (`takeFillRead`), and runs once the
recorder has read both books after it, or 120 s after its instant (`TWIN_TAKE_WAIT_MS`): forward, such a twin's turns
queue (`waiting`) and turn a call behind. `agent_book_levels` joined `TWIN_READS`; `stampTs` shows the driver each order
row it writes. Comments.

**What did not change.** Every twin without `take` runs the code path it ran: pr5's, p50's and d's specs (the tests pin
them), their turns and their records. Their backfills built again on this code are the same bytes: `pr5.json.gz`
f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98, `p50.json.gz`
f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8, `d.json.gz`
ecbec6c51dc34d1ae6d2e7b80dafa03194e3296600d460ac3fa1692b04bb9392 (rule D's built with its output discarded: nothing of its
record was printed or read). `revx_sim.test.ts` pins the take's fill beside the same IOC unmarked, which meets the turn's
book as before.

| file | sha256 |
|---|---|
| `supabase/functions/agents/revx_sim.ts` | 4b8f99e925f0ba6e05e188554e4b6bf8a43eead0aaec0b5d946a65664361f8aa |
| `supabase/functions/agents/quotes_twin.ts` | d13b3eebce3dd3e89d8707e7373597b73d7127c5d5692fc36b6fcebe1d1dac0a |

§11 and §12 keep the hashes the files had before; this table names them from this deviation on. `src/twins_prereg.test.js`
pins all of them.
