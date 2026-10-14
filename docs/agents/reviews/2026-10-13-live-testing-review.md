# Live and testing review, 2026-10-13 evening: Q2's first hours, the $0 estimate, and what to cut, change or add

On Davies' word the same evening, three instructions in order: start "Stablecoin quotes with Euros - 2" at once (done,
migration `0121`, its pre-registration's Deviation 1); research the live Reward quotes strategy deeply, above all why its
page read "REWARDS TODAY (EST.) $0 – $0"; and review every live and testing strategy. Read-only throughout: production
was read between 21:22 and 21:45 UTC, no config row, order or rule was touched, and nothing here arms, disarms or
resizes anything. Every change that would move live money is a proposal for Davies in §4. Not blind: every record was
open (Davies, 2026-10-04). The one code change in the commit that lands this file is the display defect of §1.3, fixed
under the live-watch safe-fix rules (a defect outside `pm_live.ts`/`pm_lp.ts`, with a pin that fails on the old code).

## 0. Euros - 2, verified after the deploy

At 21:22 UTC: `0121` is in `schema_migrations`; `cb_hold_state.startedAt` is 2026-10-13 00:00 UTC; `last_minute`
21:19 (3 minutes behind), updated 12 s before the read, `last_error` null; `cb_hold_minutes` holds 5,120 rows — the
1,280 minutes from 00:00 to 21:19 on four books, no gap; 491 events, 2 closed round trips (+£0.0851, the same two as
the base test today, as they should be on a weekday with fresh rates); a `cbhold` beat every minute; no
`agents.cb_hold` row in `ops_errors`. The page's "its last decided minute was 1022 min ago" that Davies saw was the
catch-up itself: the window moved to today's midnight and the engine decides at most 60 minutes a run, one run a
minute, so at about 21:03 it had decided to about 04:00. It ran current by about 21:20. Not a fault.

## 1. Reward quotes live ("live-prep", Q2 since 13:25 UTC today)

### 1.1 The old rule's closed books (2026-10-09 → 10-12, all four payouts now read)

| day | formula (whole) | formula (scored) | paid | rebates | R (whole) |
|---|---:|---:|---:|---:|---:|
| 10-09 | 8.082 (Addendum 18's figure; the table's 153.90 is stale) | 19.801 | 6.524 | 1.977 | 0.81 |
| 10-10 | 30.493 | 29.144 | 21.891 | 4.816 | 0.72 |
| 10-11 | 12.002 | 11.619 | 9.681 | 3.230 | 0.81 |
| 10-12 | 14.186 | 13.070 | 7.964 | 2.939 | 0.56 |

Pooled R on the whole formula is 0.71. The rewards were never the problem: at 21:28 the path's own state read the
fills at −$131.08 marked to market, against $46.06 paid and $12.96 of rebates — about −$72 all-in, beside an equity of
$327.98 against the $402.03 funded, which is the −$75 stop that tripped on 10-12, as LP-ADVERSE already took apart
(adverse selection in the first hour, one-shot takers). Nothing in tonight's read revises that.

### 1.2 Q2's first eight hours (restart 13:25:32 UTC; Addenda 19–21)

- **Stop room $20.83 of $25** at 21:28 (basis −$4.17 since the restart, all of it fills; nothing paid yet for today).
  State fresh (21:28:01), no `last_error`, gates all true, no new `agents.pm_lp` errors after the restart dust of
  Addendum 20 (13:26–13:42). 1,242 live POSTs today against the 12,000 governor.
- **14 fills**: 10 buys (200 shares), 4 sells (80). The four closed round trips each sold below the buy — 0.22→0.17
  within a minute (`0x40b8e1cc`), 0.76→0.72, 0.85→0.80, 0.49→0.42 — realised −$4.20 on 80 shares (−5.3 ¢ a share).
  Held from Q2 at the read: 120 shares over four markets. Markout against the others' mid in `pm_lp_minutes`
  (sign-adjusted, descriptive at n=14): −0.64 ¢ a share at 5 minutes, +0.04 ¢ at 60 (280 shares priced) — nothing like
  the old rule's adverse first hour, and nothing yet like evidence either.
- **Selection churn**: 12 picks at 13:26 (60 quiet reads, 46 busy rejected, 0 failed), then 9 refills by 17:35 — of the
  day's 10-refill allowance — with 17 markets recorded out (`state.lp.refill.outSince`). At 21:28 no BUY rested at all
  (6 sells, $54.14), and every one of the turn's 34 withheld buys was withheld at the `reward` gate.
- **Formula pace**: since 13:42, $1.04 of formula, $0.98 of it over minutes Polymarket read both sides scoring —
  284 such minutes. At the old books' R band (point 0.54 on the scored formula) that is about $0.53 of rewards in
  eight hours: 0.27 ¢ a bought share, against LP-BEST's 2.92 ¢ and Addendum 19's 1.5 ¢ bar. Bought shares are running
  at 200 in eight hours against the simulator's 136 a day (on half-recorded days), so the shortfall is not fill
  volume; it is scoring minutes and what each is worth ($0.0035 a scored minute against 10-10's $0.0109).

### 1.3 "REWARDS TODAY (EST.) $0 – $0": a display bug, on a day that is also small

The tile is `lpRewardEstimate`'s `soFar`: today's rows of `pm_lp_live_hours` (0111's view of the last 48 hours),
summed per market and priced at each market's R band. Two facts, both measured:

1. **The dashboard never saw today's afternoon.** `readLpLive` read the view with `order=hour.asc,cond.asc&limit=1000`
   on the comment "at most 48 × 10 rows". The view holds a row an hour for every market worked, carried ones too: at
   21:22 it held **1,555 rows** since 2026-10-11 21:00, and row 1,000 fell at **today 05:00**. Of today's 701 rows,
   the 146 inside the first thousand (hours 00–05, before the restart, close-only) carry a scored formula of exactly
   $0; the whole $0.98 accrued after 13:42 sits past the cut. So the estimate multiplied $0 by its band, correctly,
   forever. The same truncation fed `estimate.markets` (QUOTES' per-market reward estimates) and the projection rates.
   It is the read-capped-where-you-did-not-ask class the working-with-davies skill already names from 2026-10-07.
2. **The true figure is small anyway.** With every row, the tile at 21:22 would have read about **$0.28 – $1.01**
   (the overall band on $0.9839 of scored formula; per-market bands move the ends a little). A full Q2 day at this
   pace accrues roughly $3 of scored formula — and Polymarket pays nothing under $1 (its docs' minimum payout), which
   the estimate's full-day low already prices per market.

**Fixed in the commit that lands this review** (display only; no live rule, config or order path touched): the hours
read and the selection read beside it — the same `limit=1000`, which a forty-market refill day would exhaust in about
25 live days, dropping the newest selections first — now page to the end (`selectAll`, with `pm_lp_markets: day,cond`
and `pm_lp_live_hours: hour,cond` added to `PAGED_KEYS`). The pin stands 1,005 of yesterday's hour rows before the
fixture's and requires today's estimate unchanged; it fails on the old read (checked by stashing the fix). The page
will read cents, not $0, once `agents` redeploys.

### 1.4 Why the accrual is a fraction of the simulator's

Over the restart's 21 picks, from each pick's selection minute (9,126 market-minutes to about 21:35):

- Of minutes with a touch of 4 ¢ or more **and** a programme rate of at least $10 as read that minute, only **422 of
  1,873 (23 %) rested any quote of ours**. The rest are mostly markets already taken out (`outSince`, §1.2) or
  unfunded in rank order — the cap is the equity less $80 ($247 at the read) and carried stock still sits in it.
- **Programmes decay intraday, fast.** The median pick spent 43 % of its minutes under half its selection rate;
  3,235 of the wide-touch minutes read under the $10 floor (2,870 at $1–9, 365 at $0), where the reward check
  withholds every buy. Rank 5 was selected at $35 a day and read $0 for 94 % of its minutes. LP-SPEED measured that
  programmes change fast and priced a faster loop at +$0.3 to +$2.0 a day; tonight's read adds that in quiet books
  the change is usually the pool shrinking under the floor, after which the market is out and a refill burns.
- Where both quotes rested (378 minutes), both sides read scoring in 284 (75 %), one side in 29, neither in 65 —
  the 65 concentrated in three markets, every one with both quotes inside the programme's max spread and at its
  minimum size. Not a placement defect that this record can name; the venue's adjusted midpoint is not the others'
  mid these rows are checked against.
- The picks that filled include earnings-day names created hours earlier (the PG market filled three times) — the
  young-book pattern Q2-AGE priced and left for day 14 (its draft B′), visible live on day one.

### 1.5 Candidates — studies and proposals only; Addendum 19's test runs as written

Nothing below changes the live rule inside its 14-day window (the addendum: fail any condition and Polymarket rewards
end, nothing re-tuned on the test's own days). Each is a study to price offline, or a decision in §4.

- **P1 — programme stability at selection.** Price, in LP-BEST's engine on pm-rec's programme history, a selection
  that also requires the programme to have held (its rate not cut under the floor in the hours before 00:00), against
  the refill burn it saves. Tonight's decay table is the first live evidence for it; the simulator's picks were priced
  on the programme in force each minute, so the engine can answer it without new recording.
- **P2 — the refill allowance.** Nine of ten refills were spent by 17:35 on day one, leaving the evening to decay.
  Price a larger or uncapped refill (each still re-read quiet at its minute) in the same engine before proposing it;
  LP-REFILL priced the refill family under the old rule, not Q2's flicker rate.
- **P3 — the exit.** Four exits at −5.3 ¢ a share against a 60-minute markout near zero says the resting exit in a
  quiet book is being taken when the price has already moved. Addendum 19 already reads the 60-minute markout and
  quoting minutes beside the bar; add exit-vs-hold to that descriptive read (existing rows suffice).
- **P4 — a quote-presence readout at day 7 and day 14**: the touch/rate/quote/scoring matrix of §1.4 from
  `pm_lp_minutes`, rewards paid per filled share, and R in quiet books (the addendum's own descriptive reads, plus
  this matrix). No new recording; a script under `backtests/lpbest/` beside the day-14 reading.
- **Not candidates**: a faster loop (LP-SPEED priced it), more money (LP-BEST: not larger with more), the age filter
  before day 14 (Q2-AGE's B′ is the standing draft), quoting under a 4 ¢ touch (the two negative neighbours at 3 ¢).

## 2. Every live and testing strategy, tonight

Freshness first: every enabled minute call beat in each of the 76 minutes to 21:35 (76 beats each for `tick`,
`quotes`, `quotesv`, `quotesd`, `quotestwins`, `pmlp`, `pmlpreserve`, `pmrec`, `books`, `views`, `cbrec`, `cbhold`,
`cbbooks`, `cjrec`; the monitor's dead-man 75). `ops_errors` holds 638 rows in seven days, most of them the network
and the now-off paper paths; on live paths tonight, the restart dust of Addendum 20 and two single `agents.tick`
timeouts. Nothing below is stopped by a fault; the verdicts are about evidence and dates.

### Live (real money)

| strategy | evidence at 21:34 UTC | verdict |
|---|---|---|
| Reward quotes (Q2) | §1. Stop room $20.83 of $25; rewards pace about a sixth of the simulator's; the restart day is outside the bar | **Keep to Addendum 19's day-14 bar.** First full day is 10-14; R in quiet books reads first tomorrow. Day-7 descriptive checkpoint with P4's matrix; the Q2-AGE early flag stands (a −$10 day from markets under 3 days old goes to Davies at once) |
| PR5 live (Revolut X `_2`, £10 a rung) | Armed, state fresh, day +£0.036, not loss-stopped. Since 10-01: 150 filled legs; trading-leg cash about +£0.35 before inventory marks and £0.08 of fees, in line with the paper engine at a tenth of its size | **Keep to the 10-21 verdict**, which is the paper test's, as frozen. No size change before it |
| trend-4h-live (Revolut X, cap $60) | One live round trip ever (buy $25 on 09-28, sold $24.40); 192 live decisions in seven days, no rule entry, no veto, nothing open | **Keep as is.** Fifteen days without an entry is the rule being slow, not broken; the $150 step still has no new evidence either way and stays Davies' word alone |

### Testing (paper) and the measurements behind them

| test | evidence | verdict |
|---|---|---|
| trend-4h (paper control) | 240 decisions in 7 days, no entry; 8 fills in 30 days, the last 09-28 | **Keep** — it is the live row's same-venue control, and SUI's seat is read from it |
| trend-1h | 570 decisions, 3 entries in 7 days; 22 fills in 30 days. Kept in 0065 for feedback speed | **Keep until MX-1 reads** (its exits are MX-1's subject); no other claim on it |
| momentum-1d | 25 decisions, 1 entry in 7 days; 6 fills in 30 days. Its own Jev wording failed the bar in September; the gate runs in shadow | **Candidate to retire** at the next cleanup (D3): the shadow record is its only product now, and nothing is scheduled to read it. Cheap to keep, cheaper to decide |
| PR5 paper engine | 124 trips in 28 days, +$11.74 (117 won, 3 stops); 7 days +$2.79 | **Keep.** It decides PR5 on 10-21, feeds the live executor order for order, and both Coinbase tests read its stored GBP/USD — it runs to 11-10 whatever 10-21 decides (the Euros tests' dependency, ledger item 12) |
| Twins `pr5`, `p50` | Fresh; 203 / 228 fills. Readouts due beside PR5's verdict (10-21) and rule D's (10-28) | **Keep to those readouts**, then they are candidates to stop together — `p50`'s last claim (p50x1) was withdrawn by `0109` |
| Twin `take50` (TAKE) | Fresh; 238 fills. Window to 2026-11-02, extendable a week at a time to 11-30 until 15 take trips close | **Keep to TAKE's reading** as pre-registered |
| Twin `d` + `quotesv`/`quotesd` (PR5V, rule D) | Fresh (`agent_quoted_state` current, no error); `main` arm +$2.23 today on 94 trips | **Keep to 10-28.** Both reading scripts are due by 2026-10-27 00:00 — that is dated work, not optional |
| Stablecoin quotes with Euros (Coinbase) | Window 10-11 → 11-08. Ten trips so far, +£0.575 — every one on a EUR book; the two GBP books have filled nothing | **Keep to its 11-08 reading.** The GBP books' silence beside the same rule's Revolut X fills is a question its reading should answer per book (the replay already reports by book) |
| Stablecoin quotes with Euros - 2 | §0. Window 10-13 → 11-10 under Deviation 1 | **Keep.** Its first whole weekend is 10-16/18 |
| CJ5 recorder (CoinJar) | Fresh; trades backfilled (2,368 USDC/GBP and 1,281 USDT/GBP prints in the newest 4,000 rows), books recording each minute | **Keep recording; decide the forward paper test** (D4). The draft pre-registration has waited since 10-09 while its book history accrues — freezing or dropping it by 10-21 costs nothing either way |
| QUEUE, PR5-W, MX-1, EX-GAP, LPRESEL6 | Their recorders are fresh (`books`, `pmrec`, `pmrec-meta`, `views` all beating); each reading is dated in the ledger (10-18 → 12-23) | **Keep all.** The freeze lines hold as written; nothing here is a candidate to cut early without voiding a reading |
| Paper Reward quotes (RW-C and family) | Off since `0120` today; TESTING shows no row | **Already cut by Davies' word.** LPRESEL6 still reads from pm-rec on 10-23 with its deviation note |
| mini-pool, mid-pool | Calls off, configs unarmed in dry-run | **Keep off.** Mid-pool's funded draft was withdrawn with `0120`; neither is a go-live candidate |

### Records worth adding (each needs Davies' word; none is built here)

- **N1 — the selection's programme snapshot, if P1 is taken up.** First check whether pm-rec's meta already holds each
  candidate's programme through the day; build a record only for what it lacks. Pricing a stability filter on picks
  alone would be survivorship in a table.
- **N2 — a one-off audit of single-page reads on dashboard paths.** §1.3's class: `select` with `limit=1000` in
  `index.ts` (`agent_quote_trips` newest-first, which only shortens a list, and the off RW selection reads). List
  them, and let each be paged or proven bounded in a comment with its bound measured, not asserted — "at most 48 × 10"
  was an assertion.
- **Not proposed**: a second Polymarket design before Q2's bar (PMOPPS closed the list tonight's evidence does not
  reopen: DEADLINE-NO failed its frozen 2024 test today), a Coinbase live path (no order path exists; the tests are
  paper and decide funding later), or any new recorder whose study is not yet pre-registered.

## 3. Decisions for Davies

1. **D1 — Q2 runs on** to its day-14 bar as written (recommendation), with the day-7 descriptive checkpoint (P4) and
   the Q2-AGE early flag. The alternative — stopping it tonight on eight hours — spends the test Davies already
   bought for the price of its stop ($20.83 of room left). First full day 10-14; first R-in-quiet-books reading
   tomorrow after 03:00 UTC.
2. **D2 — the $0 display fix** ships in this commit (no live rule, config or order touched). Nothing to decide; the
   page will read about $0.28 – $1.01 for today once `agents` redeploys.
3. **D3 — momentum-1d**: retire it at the next cleanup, or keep it as the Jev shadow record. No money either way.
4. **D4 — CJ5's forward paper test**: freeze the draft or drop it, by 2026-10-21 beside PR5's verdict.
5. **D5 — after 2026-10-23** (LPRESEL6 read): whether `pmrec`/`views` keep recording. They cost about 12 MB a day
   (`pm_view_books`, ledger item 9) and after that date nothing scheduled reads them.
6. **D6 — trend-4h-live's $150 step**: still no second live entry to judge two concurrent slots by. No change
   recommended; it remains your word whenever the evidence moves.

## Postscript, 2026-10-14 01:08 UTC (read before this landed)

The 10-13 payout is now read: formula $1.2409 whole / $1.1791 scored over 329 scored minutes, booked paid **$0.8921**
— **R 0.72 on the whole formula, 0.76 scored**, in family with the old books' 0.71 pooled — plus $0.6175 of rebates.
So the first R-in-quiet-books reading is not the problem; the count of scoring minutes is, as §1.4 has it. (Booked
paid is the readout's per-market figure across 11 markets; what the venue disburses under its $1 minimum is its own
arithmetic.) The less comfortable move is the fills: since the evening read they went from −$4.17 to **−$10.91**
since the restart (basis −$9.40 with the payout and rebates counted, **room $15.60 of $25**), and the new day had
posted 405 times by 01:08 with 15 markets quoting. One evening and an hour is not a pace — marks on 120 held shares
swing — but if the first full day (10-14) closes below −$10, that should reach Davies the same night rather than at
the day-7 checkpoint. Euros - 2's first day closed as §0 read it mid-evening: 510 orders, 4 fills, 2 round trips,
+£0.0851; at 01:08 it is deciding 01:05, no error. The error box since 21:45 holds one Kraken timeout blip.

## Not checked

- Venue balances were not re-read tonight: no claim here rests on an account figure the venue has not already
  reported into these tables, but PR5's and Q2's fills were not re-proved against the venues' own balances.
- R in quiet books has one partial-day reading (the postscript: 0.72 whole on $1.24 of formula); every other reward
  figure for Q2 above is formula, priced at the old books' R where a dollar sign is attached.
- The markout uses the others' mid from `pm_lp_minutes`, not the trade tape; at n=14 it is a pace note, not a verdict.
- The twins' realised figures are page-computed from their orders; tonight's read took their filled cash and
  freshness, not a re-derivation of their books.
- Table sizes were not measured (the read path used cannot see `pg_total_relation_size`); growth figures quoted are
  the ledger's.
- The dashboard payload itself was not fetched (this session holds no app password, and none was tried): the $0
  tile's arithmetic was recomputed from the same rows the dashboard reads, with the truncation reproduced exactly.


