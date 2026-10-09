# Stablecoin quotes, TESTING's four twins and LIVE: where they stand, what is new, what to change (2026-10-09)

Davies, 2026-10-09: "testing的4个Stablecoin quotes进展如何？live的进展如何？都有新发现吗？所有数据都可以看，并且结合一直在记录的订单簿，
有inform给live的Stablecoin quotes改进或优化的地方吗？testing的策略有改进或优化的地方吗？或者删掉或新增testings？"

**Not blind, and no reading.** Every record was read for research (there is no no-peek rule since 2026-10-04). No
pre-registered reading was run, none is pre-empted, nothing was changed in production, and no order was placed or
cancelled. The PR5 verdict (10-21), the twins' readouts (10-21, after 10-28), PR5V and rule D (10-28) and TAKE (window to
11-02) run as their pre-registrations say; each of their result files should name this review as a further non-blind
read of their records.

**Sources.** Production read 2026-10-09 15:50–16:15 UTC, SELECT only (`docs/agents/backtests/scq_review/sql/`: the pulls
with `pull_orders.sql`, every aggregate with its output in `aggregates.sql`, the mark-outs in `markouts.sql`). The money
is the page's own: `scripts/page_pnl.ts` calls `liveRungs`, `liveRungTrips`, `liveCoinBooks` and `liveBookGbp` from
`supabase/functions/agents/index.ts` on the pulled orders (`results/page_pnl.json`). Two measurements of new ideas:
`scripts/dust_exit.ts` (the executor's own `pennyExit` and `pennyUp`, `results/dust_exit.json`) and
`scripts/exit_offset.py` (`results/exit_offset.json`). "7 days" is 2026-10-02 16:00 → 10-09 15:58 UTC, trips by the
time they closed.

## 1. Where each row stands

The five rows are one rule's decisions carried out at different sizes, plus two rule changes. All four twins are healthy:
`_sim.last_error` and `_state.last_error` empty, turning every minute (`agents?action=quotestwins` 60 beats in the last
hour, 1,440 in 24 h), `paperCheck.mismatches` 46 for pr5, p50 and take50 (all before 2026-09-24 18:13, as known) and 0
for d (20,271 events checked through 15:45). TAKE's check K1 holds: take50's 3,360 orders before 2026-10-04 16:00 equal
p50's both ways. The live executor: state 15:57:26, no error, governor "all", 253 POSTs today, nothing `pending`, 12
orders resting.

| row | from | capital | trips (won / stops) | realised | per trip | a year on capital | 7 days: trips, realised, a year | coins' mark | orders a day (10-05 → 10-08) |
|---|---|---|---|---|---|---|---|---|---|
| LIVE (£10 a rung) | 10-01 16:29 | £120 | 42 (30 / 3) | **+£0.2126** | 6.4 bps | 8.1 % | 35, +£0.2484, 10.8 % | −£0.1700 | 452–951 |
| Stablecoin quotes (`pr5`, £100) | 09-23 15:09 | £1,200 | 76 (66 / 3) | +£8.6076 | 13.7 bps | 16.3 % | 32, +£3.0371, 13.2 % | +£0.0241 | 415–874 |
| variant-1 (`p50`, £50) | 09-23 15:09 | £600 | 87 (75 / 3) | +£5.2830 | 14.0 bps | 20.0 % | 33, +£1.6175, 14.1 % | +£0.0901 | 443–733 |
| variant-2 (`take50`, TAKE) | 09-23 15:09 | £600 | 91 (77 / 3) | +£5.4907 | 13.9 bps | 20.8 % | 37, +£1.8252, 15.9 % | +£0.0901 | 458–662 |
| variant-3 (`d`, rule D, £50 × 36) | 09-28 00:00 | £1,800 | 375 (268 / 9) | +£12.7408 | 7.9 bps | 22.1 % | 184, +£4.9447, 14.3 % | −£0.2427 | 1,360–2,553 |

Realised is the page's (fees, pennies and the conversions' fees in it). "Coins' mark" is the page's UNREALIZED: the
coins the asks hold, at the ticker's index price against what they cost (section 3, F2). The twins' "from" includes
their backfills to 2026-10-02 21:05 (in sample); the last 7 days are all forward.

**Fills, refusals, fees, top-ups.** LIVE: 93 fills (42 entries, 44 exits, 3 bounded 24-hour stops, 4 conversions), fill
rate 41 of 2,428 entry decisions (1.7 %); PR5's twin 34 of 2,357 (1.4 %) on the same decisions. Refused at the book and
never sent: 18 live, 19 twin. Venue refusals since 10-02: none (14 on 10-02, the known penny-hold top-ups and
double-counted coin, both fixed that day). Fees: LIVE £0.0840, of which £0.0540 the two go-live taker conversions
(10-01), booked to the trips that sold those coins; every quote fill since is a maker's 0 %. Top-ups: 2 filled on 10-02
(£0.30 of coin at 0 %), 3 cancelled unfilled after 30 minutes (the last sent 10-06 15:46). The three LIVE stops (10-08
02:56–03:01, three USDT bids from 10-07's stall) made +£0.0189 together (two in profit, one −£0.0005).

**The paper engines behind the page** (USD, their own trips, read for this review only): PR5's paper test 99 trips, 95
won, +$10.9875 since 09-24 ($0.69 a day against the spec's $0.26 bar; 7 days 41 trips, +$3.1971; no stop). PR5V's `main`
and rule D's `v1` are the same 381 trips (+$20.2806) to the cent, so rule D's precondition holds so far; rule D's arm `d`
401 trips, +$19.5203, $0.76 under `v1`. None of this is a reading.

## 2. Does LIVE track its paper twin?

Since 10-04, yes, within about a tenth. The first three days did not, for reasons already known.

| trips entered | LIVE | PR5's twin ÷ 10 | variant-1 ÷ 5 |
|---|---|---|---|
| 10-01 16:29 → 10-03 | 10 trips, −£0.0278 | 6, +£0.0689 | 7, +£0.0738 |
| 10-04 → 10-09 | 32 trips, **+£0.2404** (11.3 bps on trips of £1 or more) | 28, +£0.2494 (13.8 bps) | 29, +£0.2692 (13.8 bps) |

Per pound of capital since 10-04: LIVE 0.200 %, `pr5` 0.208 %, `p50` 0.224 %. The 10-04 → 10-09 LIVE figure still
carries £0.0270 of the go-live conversions' taker fee (three USDC asks' shares); without it LIVE is +£0.2674, level with
variant-1. The first three days' gap is the
stall of 10-02 (three bids rested through it at old prices), the conversions' fee and the first trip's penny (reference
§4 item 51 and the 10-02 archive).

**The same decisions, side by side** (entries joined on the paper engine's order and its live instant, `aggregates.sql`
B): of 2,268 decisions both sent, both filled 23, LIVE alone 10 (9 of £1 or more), the twin alone 3. LIVE fills about a
fifth more often than the twin, and where: **USDC-GBP bids filled 7 times live and never in the twin.** These are fills at
our own price with no print through it — a taker hitting our order while it was the best price inside the resident
maker's spread — which the twin's fill rule (a print strictly through) never counts. The validation of 10-02 saw six;
eight days later it is the main difference. They are good fills, a little weaker than the rest (mark-outs below), so the
twins are conservative, and QUEUE (window to 11-01) is the study that measures them.

**Adverse selection: none on entries.** Mean mark-out against the recorded book's mid, in bps in the fill's favour
(`results/markouts.txt`):

| entries | n | 0 min | 1 | 5 | 15 | 60 | against fair, 60 |
|---|---|---|---|---|---|---|---|
| LIVE, fills the twin also had | 17 | 10.7 | 6.0 | 5.7 | 9.4 | 12.6 | 14.5 |
| LIVE, fills only live had (at our price) | 16 | 5.9 | 2.9 | 4.1 | 6.5 | 7.4 | 8.4 |
| `pr5` / `p50` | 34 / 36 | 9.4 | 7.0–7.1 | 5.7 | 10.0–10.2 | 13.3–13.4 | 14.8–14.9 |
| `d` | 205 | 5.1 | 3.3 | 3.2 | 5.0 | 7.3 | 8.7 |

The book dips toward our fill for a minute or five and then goes back toward fair; fair itself hardly moves. Exits mark
out at about zero after five minutes (`pr5` −1.4, `p50` −0.7, `d` 0.0 bps at an hour): an exit at fair gives nothing
away to later moves.

## 3. What is new

Known before today and not repeated as new: 10-07's dead-man storm and its fix, the 10-02 stall, the taker conversions,
the governor's 900/950, the size study's per-rung table and the idle 0.3 % asks.

- **F1. A £0.10 "dust" print nibbles a rung, and the buy-back pays a penny for nothing.** The venue's minimum is £0.10, and
  someone trades exactly that (prints of 0.13235 USDT). When it takes our resting entry, the rung holds 0.13 coins: the
  executor withdraws the rest of the entry and posts an exit for the holding (plus the hair carried from earlier trims).
  A buy-back worth between £0.10 and £0.11 cannot be trimmed to the penny below (that would fall under the minimum), so
  `pennyExit` sends it as it is and Revolut X debits the next whole penny: live fills 3956 (10-08 12:16, 0.13587 USDT at
  0.7567 for £0.11: an average of 0.8096), 4245 (10-09 04:05, £0.11 for 0.13584 at 0.7545) and 4304 (10-09 07:28, £0.11
  for 0.13792 at 0.7543). 9 of LIVE's 42 entry fills were dust-sized (21 %); the three whole-filled buy-backs paid
  £0.0207 for nothing, a tenth of LIVE's realised. The twins meet it too (pr5 £0.0434, d £0.1169 in all, partial fills
  included), but at £50–£100 a rung it is noise.
- **F2. The coins the asks hold carry GBP/USD, and over days that swamps the edge.** About half of each account is USD
  coin. GBP/USD moved 33 bps a day (standard deviation of the 15 daily changes, 09-22 → 10-09), so LIVE's £60 of coin swings
  about £0.20 a day against a realised edge of about £0.04 a day: UNREALIZED −£0.1700 today is the pound's rise since the
  go-live conversions (bought at 0.7572/0.7579, index now 0.7550/0.7558), not the strategy. Over a year the edge wins
  (about £15 against a yearly swing of about £3); over the twelve days to 10-21 the two are about the same size. Judge the rows
  on realised; the paper engine's verdict is unaffected (its trips carry no inventory).
- **F3. Exits at fair leave a tick on the table.** An exit sits at fair rounded our way, inside the resident maker's spread,
  and in the twins it fills when the market trades at that maker's far quote, usually two or more ticks through it.
  Moved one tick (0.0001, about 1.3 bps) further, it would still have filled in 67 of 67 of `pr5`'s maker-exit trips, 76
  of 77 of `p50`'s and 335 of 336 of `d`'s, on the same print (median delay 0 minutes), for +£0.74 (`pr5`, +8.6 %), +£0.45
  (`p50`, +8.6 %) and +£1.98 (`d`, +15.5 %) over their records. Two ticks: 65 of 67, median 15 minutes later; three: 62
  of 67. For LIVE, whose exits often fill sooner at their own price, one tick fills 29 of 30 but a median 27 minutes
  later. An indicator, not a replay: the stored prints only (16 days of the tight market), the exit's re-price with fair
  and shared depth not modelled. It is the one rule change this review found worth testing (section 5).
- **F4. LIVE's extra fills are the twins' blind spot, and they are good fills** (section 2): +20 % fills, mark-outs 3–7
  bps instead of 6–13. The twins understate LIVE's fill rate; they do not flatter it.
- **F5. A venue episode on 10-08 16:03–16:22 UTC was handled as designed.** Cancels took eight minutes to land (asked
  16:03:29, landed 16:11:26), order reads answered 404 for about five minutes (16:11–16:16), and a USDC print at 0.7500 sat 93 bps under fair.
  The executor froze the rungs (17 `ops_errors`), sent nothing while they were frozen, and the de-peg guard withdrew the
  five USDC entries at 16:17. The one cost: a USDT bid filled while its re-price cancel waited (4107), a trip of −£0.0100.
- **F6. The paper engine fell two minutes behind every ten minutes on 10-08 00:10–01:10** (and once at 17:12): the
  executor's stale-input guard cancelled and re-placed its nine entries each time, 59 cancels and as many POSTs again.
  Seven minutes of 10-08 were over 120 s late; none since. Transient; nothing to change.
- **F7. Rule D's innermost rungs do nothing but spend POSTs.** In `d`, the 0.03 % rungs made 114 trips for +£0.26 (about
  0 bps a trip: a 3 bps edge less a 2 bps penny at £50), the 0.05 % rungs 75 for +£1.01; `d` has sent 1,355–2,701 POSTs a
  weekday over its four keys, more than one account's 1,000. This is evidence for rule D's 10-28 readout, not a change now.
- **F8. TAKE is on pace** (descriptive, not its reading): 5 takes since 10-04 16:00 (10-05 02:51 and 02:59, 10-06 11:16,
  10-08 02:59 and 05:53; all USDT-GBP, all filled whole), 3 won, +£0.2926; variant-2 minus variant-1 over trips opened
  in the window +£0.21. About one take a weekday reaches C1's 15 by 11-02.

## 4. LIVE: what to change

**Safe to do now (bug-like; a change to the live order path, so built on Davies' word):**

1. **Size a buy-back at the venue's minimum to the whole penny it pays** (F1). Where `pennyExit` cannot trim a buy
   because the trim falls under £0.10, send `floorToStep(pennyUp(n) / price)` instead: the same £0.11 buys about 0.145
   coins, the holding plus a hair the account's asks then use. Priced on the recorded fills (`scripts/dust_exit.ts`): the
   three LIVE cases would have paid £0.0000 for nothing instead of £0.0207 (+10 % of LIVE's realised to date, about
   £0.0026 a day); certainty high (the venue's own arithmetic, pinned in `revx_sim.ts` rule 2). It changes nothing above
   £0.11. The twins run the executor's code, so they take it too: record it as a deviation of the twins' and TAKE's
   pre-registrations (it touches both TAKE arms alike). A pin: the three fills' sizes and pounds before and after.
2. **Nothing operational is broken.** The dead-man storm is fixed (10-07), the venue episode was handled (F5), the stale
   churn was transient (F6), no order is pending, no venue refusal since 10-02.

**Rule changes (each needs its own pre-registration and Davies' go; none now):**

3. **Exit one tick beyond fair** (F3): test it first as a twin (section 5); move LIVE only if it passes.
4. **Size is the lever, and it is Davies' call at the 10-21 verdict.** Per pound LIVE earns what the twins earn (0.200 %
   against 0.208–0.224 % since 10-04), so £600 (£50 a rung) would make about five times LIVE's pounds; F1's penny is a
   fixed cost per dust print, so it also shrinks relative to a bigger rung. TAKE only ever makes sense at £50 a rung or
   more (its own pre-registration).
5. **Wait for the readings:** TAKE (11-02 + 2 days), rule D (10-28; F7 says its inner rungs add nothing), TrueFX (only in a
   live path after 10-21, as the ledger has it).
6. **Not recommended:** dropping the asks or quoting bids only (this week the asks made more than the bids: `pr5` +£1.63
   against +£1.40), or dropping the 0.3 % asks (they free £20 of LIVE's coin and some FX exposure, F2, but they made the
   rare 30–47 bps trips; revisit at 10-21 with four weeks).

## 5. TESTING: keep, remove, add

- **Keep all four unchanged to their dates.** `pr5` and `p50` are read beside PR5's verdict on 10-21 (and `p50` beside
  `d` after 10-28); `take50`'s window runs to 11-02 (11-30 at the latest) and is on pace (F8); `d` is read after rule D's
  10-28 reading. Each is frozen, healthy and still measuring something the others do not.
- **Remove after their readings, not before:** `d` after 10-28 unless rule D passes (F7: its inner rungs add nothing, and
  its four keys need more POSTs than one account has); one of `pr5` and `p50` after 10-21 (the same decisions; per pound
  they agree within a tenth since 10-04), keeping the one at the size Davies picks for LIVE.
- **Add one: "Stablecoin quotes variant-4", `p50x1`, variant-1 with its exit one tick beyond fair** (F3). It needs a small
  rule extension (the executor's `exitTicks` plus `offset` ticks, LIVE's default 0, so LIVE's instance test still finds
  it equal to the frozen file), so it is not a two-statement row: the draft below, to freeze on Davies' word with its
  build. Optional and cheaper (a two-statement row): a £10-a-rung twin of PR5's rule at LIVE's exact size, to price the
  twins' fill rule against LIVE decision for decision; QUEUE answers most of that on 11-02, so it can wait.

## 6. In plain words (for Davies)

- The four TESTING rows are healthy and running as planned; nothing in them has broken.
- Over the last 7 days, per year on the money each uses: LIVE about 11 %, the twins 13–16 %. Since 10-04 LIVE has made
  almost exactly what its paper twin made, scaled to its size; the gap of the first three days was the outage and the
  first conversions, already known.
- LIVE gets about a fifth more fills than the simulation, because people trade directly with our price; those fills are
  profitable. The simulation is, if anything, cautious.
- Nobody is picking off our quotes: after we buy, the price moves our way, not against us.
- The red "unrealised" figure on LIVE is the pound's move against the dollar on the coins we hold, not a loss of the
  strategy. Judge it on realised.
- Two improvements: (1) a small fix — when someone trades the minimum £0.10 with us, the buy-back wastes a penny; that
  penny was a tenth of LIVE's profit so far, and the fix is safe; (2) a test — placing the exit one tick further would
  have earned 9–15 % more in the twins with almost no delay; I suggest testing it as a new variant before changing LIVE.
- The biggest lever for LIVE is its size, which is your decision at the 10-21 verdict.
- Keep all four tests; after their readings, rule D's row and one of the two size twins can probably go.

## Appendix: draft pre-registration, "Stablecoin quotes variant-4" (`p50x1`), exit one tick beyond fair

*A draft from `reviews/TEMPLATE-variant-prereg.md`. Not frozen: it freezes, as its own file
`reviews/YYYY-MM-DD-p50x1-prereg.md`, with the commit that adds its migration and build, on Davies' word.*

**0. On whose word.** Davies' question of 2026-10-09 (above), and his word on this draft, quoted when it freezes.

**1. What differs from its base.** Base `p50` (variant-1): PR5's paper engine, £600, £50 a rung, one governed key. Only
the executor's exit price differs: `exitTicks(fair, side)` plus one tick in the position's favour (a long sells at
`ceil(fair/tick) + 1`, a short buys back at `floor(fair/tick) − 1`), both when the exit is placed and when it is
re-priced; the 24-hour stop, the re-price step, sizes and entries unchanged. Its row:
`{"id": "p50x1", "display_name": "Stablecoin quotes variant-4", "display_order": 50, "engine": "pr5", "capital_gbp": 600,
"gov": "account", "start": "<window start>", "table_prefix": "agent_quote_twin_p50x1", "lease": "quotes-twin-p50x1",
"rules": {"exitOffset": {"ticks": 1}}, "backfill": null, "prereg": "<this file>", "migration": "<next free>",
"enabled": true}`. Build (it is not a parameters-only row): `QuoteLiveInstance.exitOffsetTicks` (default 0, LIVE's) used
by both exit placements in `quotes_live.ts`, `TWIN_RULES.exitOffset`, a pin that a perturbed offset fails
`quotes_live_instance.test.ts` only when set, and the page's row from the spec as the other twins.

**2. Why.** F3 of this review: on the stored prints, one tick further would still have filled 76 of 77 of `p50`'s exits
(+£0.45, +8.6 %) with a median delay of 0 minutes; the indicator models neither the re-price nor shared depth, so only
running it can say.

**3. Window, reading, bar.** Window: trips opened from the first Monday 00:00 UTC after the build is deployed, for four
weeks (20 weekdays). Read on or after the window's end + 2 days, and never before `p50`'s own readout of 10-21, by a
script committed before the window ends, from `agent_quote_twin_p50x1_*` and `agent_quote_twin_p50_*` (pages' own
`liveRungs`/`liveRungTrips`). **Bar, all three:** (B1) at least 60 closed trips in each arm; (B2) `p50x1`'s realised
minus `p50`'s over trips opened in the window > 0; (B3) a day-block bootstrap of the weekdays' daily differences
(Python `random.Random(<seed fixed at freeze>)`, 10,000 resamples of as many days with replacement): the 5th percentile
> 0. Descriptive beside it: trips each side, exits filled at their first price, delay to fill, stops, mark-outs. A pass
goes to Davies as a candidate for LIVE's exit at £10 or his chosen size, with its own pre-registration.
Until the reading, health daily: `_sim.last_error`, `paperCheck.mismatches` equal to `p50`'s, `updated_at` against PR5's
call, beats.

**4. Its record before now.** None (it starts at its migration's minute; no backfill), so nothing in sample is scored.

**5. Frozen files.** The migration and the build commit's `quotes_live.ts`, `quotes_twin.ts`, `revx_sim.ts`, with their
sha256 at freeze.

**6. Disclosures before the freeze.** This review: every twin's trips, mark-outs and F3's indicator on all of them, read
2026-10-09.
