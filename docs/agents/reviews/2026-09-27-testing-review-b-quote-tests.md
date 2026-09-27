# B. The two quote tests: PR5 (Stablecoin quotes) and the RW family (Reward quotes)

> Appendix B of `2026-09-27-testing-portfolio-review.md`, written by a read-only research agent and kept as it
> reported. The local scripts it names in §6 were not kept; the SQL is there.

Read-only review, 2026-09-27 21:39 → 22:30 UTC. Production read with SELECT only (project `flmvxigozjuizpckllvk`);
the committed PR5 inputs replayed through the frozen simulator `docs/agents/scripts/pr5/pr5_sim.py` (sha256
`56fbad85…` checked, imported unchanged, on data every earlier study has already seen); 22 keyless public GETs of
Revolut X's hourly USDT-USD candles between 21:45 and 22:04 UTC. Nothing was written, deployed or ordered; no secret was read; no account
balance is quoted. **No-peek rules kept:** `pm_rw_fills`, `pm_rw_minutes`, `pm_rw_prints` and `pm_rw_selection` were
not queried at all; of `pm_rw_days`, `pm_rw_e_days` and `pm_rw_x_days` only the aggregate columns were read (never
`detail`); of the three RW states only `last_minute`, `last_error`, `updated_at`, the scalar check fields and the
LENGTH of RW-E's `diverged` list. No market-level figure of any day was read.

## 1. Summary

1. PR5 paper is healthy: every minute decided (~87 s after it starts, no gap, no error), orders ≤ 440 a day, 9/9 fills acceptable at go-live, regime still 4 bps (W39).
2. Its record decides nothing yet: 9 round trips from 6 fill minutes, +$1.08 in 4.27 days = $0.25/day (plan $0.42, bar $0.26), 0.6 SD under plan; even 10-21 gives a point estimate (8 %/yr at 80 % power needs ~81 days).
3. The dry-run matches the paper order for order since the 09-24 21:36 fix (09-25: 70/70 bid entries per book); it quotes bids only and never fills.
4. For the review: fair omits the newest hourly candle 59 minutes an hour (the venue hides the just-closed hour ~3 min; the engine fetches at hh:00:27) — 5 of 302 prices one tick off; one fill sized on a 0.26-USDC print (history: ≤ 3 % of P&L).
5. PR5 arms: only weekend quotes (the frozen rule while FX is shut, replayed on stored prints) is worth pre-registering; pre-declare four readings of the record for 10-21; drop rung/side/book/step/inventory/size arms.
6. RW family runs clean (every check $0.00); RW after 2 of 14 days +$219.72, stress −$28.53 — its verdict turns on stress and concentration.
7. Pre-register before 10-09: a mechanical choice among the five overlapping arms, a 14-day forward confirmation (RW-C), and fixed readings (live capital, fills at our price, rebates) — draft in §4.4; RW-C needs a build on Davies' word.
8. No other quote idea; the queue model on the recorded stablecoin books (fp5 item 5) is the one open line — freeze it before anyone reads `agent_book_levels`.

## 2. PR5: its record and an honest interim reading

### 2.1 Health (SQL in §6, Q1–Q9)

| check | reading |
|---|---|
| engine state | `last_minute` 21:38 at 21:39:41 (one minute behind, as designed), `last_error` null |
| minute record (`agent_quote_minutes`, from 09-25 00:05) | 4,176 of 4,176 minutes per book to 21:39, no gap; each decided a median 86.7 s after its start, p99 ≤ 107 s, max 148 s; none over 150 s |
| FX (Yahoo) | live 531 / 1,440 / 1,310 minutes on 09-23 (from 15:09) / 09-24 / 09-25; dark from Friday 21:40 (Yahoo's last bars 21:25–21:29 repeat the close; a lone 22:59 bar arrived later); no stored value was revised after the engine read it (1,295 minutes checked) |
| prints stored | USDC-GBP 254, USDT-GBP 759 since 09-22 |
| errors | `ops_errors`: one `agents.quotes_live` on 09-24 (pair config timeout); nothing for the paper engine |
| pg_net (last ~6 h) | 2,468 × 200, 8 × "Failed sending data to the peer" (19:41–21:11, already in the ledger); a missed quotes call is caught up next minute (120 minutes a run) |

### 2.2 The record against the spec's six conditions

Window: 2026-09-23 15:09 → 09-27 21:38 UTC = 4.27 calendar days, 2.28 FX-live days (weekends are dark by the spec).

| day | orders | refused | withdrawn | fills | exits | stops |
|---|---:|---:|---:|---:|---:|---:|
| 09-23 (from 15:09) | 116 | 4 | 0 | 0 | 0 | 0 |
| 09-24 | 440 | 18 | 0 | 3 | 3 | 0 |
| 09-25 | 306 | 4 | 10 | 6 | 5 | 0 |
| 09-26 / 09-27 | 0 | 0 | 0 | 0 | 1 (Sat, a Friday position) | 0 |

Round trips: **9, +$1.0829**, all maker exits, all positive, median hold 93 min. USDT-GBP 6 trips +$0.699, USDC-GBP 3
+$0.384; bids 6 +$0.842, asks 3 +$0.241; the 0.1 % rung 7 +$0.606, 0.2 % 1 +$0.186, 0.3 % 1 +$0.292. The 9 fills came
in 6 minutes (18:57 on 09-24 filled all three USDT bids from one £27.5k sweep).

| # | condition | now | can it be read? |
|---|---|---|---|
| 1 | faithful (±5 % fills, ±10 % P&L) | not replayed here; see 2.4 | at the review |
| 2 | P&L > 0 and > the null's p95 | +$1.08; null not computed | no (9 trips) |
| 3 | ≥ $0.26 a day | $0.254 per calendar day ($0.475 per FX-live day) | no (see 2.5) |
| 4 | ≥ 90 % of fills acceptable at go-live | 9 / 9 accepted; 1 / 9 at the best price (the other 8 rested behind the touch and filled on sweeps) | on track |
| 5 | ≤ 700 orders every day | max 440 | on track |
| 6 | weekly buy−sell gap | W39: 3.98 bps over 45 pairs (USDC 5.96 / 8, USDT 3.98 / 37); §3.27's post-change weeks 3.3–5.4 | the tight regime persists |

### 2.3 The dry-run executor against the paper engine (reference §4 item 35, L1–L5)

* L1: last turn 21:39:27, minute 21:38 (the paper engine's), `dryRun` true, `armed` false, `lossStopped` false, guards
  "dark" on both books, `held` empty, no error.
* Counts, paper bid entries against dry-run entries by the minute they carry out: 09-24 USDC 89 / 94, USDT 100 / 105
  (the five extra each are the pre-fix re-sends of refused orders); **09-25 USDC 70 / 70, USDT 70 / 70, none refused.**
* L3 (entry priced differently from the paper order it names): ids 4 and 108 only, both 09-24, the two the fix note
  explains. L4 (paper bid decision not carried out): 09-24 12:49 (named in the fix note) and 14:28 (USDC-GBP bid 0.1 %,
  a re-placement after a refusal: not named there, same mechanism), both before the fix (`1bf254da`, 21:36 UTC).
  Nothing since.
* L5: 354 ask skips (no USDC/USDT in the sub-account); guards only at 09-24 12:31 (paper engine one minute late, no
  pair config that turn) and from 09-25 21:41 (dark); no loss stop, no unfilled stop.
* **What the dry-run cannot show:** fills, exits, stops, asks, the venue's real post-only acceptance, and the
  implementation shortfall. Note for the live calibration: the executor places a paper decision about 30 s into the
  minute the paper counts it live from (the paper engine decides minute t at about t+1:25; on the first evening the
  dry-run rested from 18:14:30 for orders the paper counted live from 18:14:00), so a stale live order can be hit in
  those seconds after a re-price and a brand-new one misses them; both are live-only effects to measure, not bugs.

### 2.4 Two things the four-week review should expect

**(a) The fair lags one hourly candle for 59 minutes an hour.** In 4,066 of 4,176 decided minutes per book the engine's
fair took one hourly close fewer than the spec's definition (closes of the candles lying wholly inside [t−24 h, t)); the
missing one is the newest (the engine's fair equals the median without the newest close in 4,042 of 4,042 USDC-GBP
minutes :01–:58 and in all but 44 of 4,042 USDT-GBP ones). Cause, seen live today: Revolut X's
`/1.0/public/candles/USDT-USD?interval=60` listed the forming 21:00 candle at 21:59:55, then from 22:00:05 to 22:03:13
(19 reads) returned no 21:00 candle at all, only the forming 22:00 one, and had it back by 22:03:33 (one hour observed);
the engine fetches once an hour, at about hh:00:27 (after its 25 s wait and the two print reads), inside that gap, and
marks the hour fetched whether or not its candle came back (`quotes.ts`, `if (ok) st.hourFetchedFor = completedHour`),
so the close arrives with the next hour's fetch. Effect: fair differed by 0.5 bp in 293 (USDC, 7.0 %) and 471 (USDT,
11.3 %) of the 4,176 minutes; of the 302 placements and re-prices since 09-25 00:05, 13 used a different fair and 5
(1.7 %) a price one tick away (USDC 20:12 bid 0.1 % 7540 vs 7541 — the bid that filled at 20:59, one tick ≈ $0.013 on
that trip — 20:58 ask 0.3 %, bid 0.2 %; USDT 18:33 ask 0.3 %, bid 0.1 %). It can also move a re-price across the 5 bp
step, as on the first evening (21:48, 0.106 bps past the step). This is the spec's own "once an hour at the first turn
after hh:00" meeting the venue's publication delay; the rule is unchanged. **Recommendation, not a change to the test:**
read condition 1 as the spec says (stored candles), and beside it replay the same minutes on the per-minute inputs the
engine recorded (`agent_quote_minutes.x`, `fair_u`; for 09-23 15:09 → 09-25 00:05, the same lag rule), which should
reproduce the engine exactly; a condition-1 miss that the second replay removes is input timing, not the engine. Any
live-path or new-arm code should re-fetch until the completed hour's candle is present (or fetch at hh:05). The live
executor prices from the paper engine's fair, so it carries the same lag.

**(b) The size rule can credit a fill the tape does not prove.** The fill size is min($100, 10 % of the minute's
printed volume, both sides). The 20:59 USDC-GBP ask (09-25, 0.1 %, +$0.119) was credited 99.88 USDC on a 0.26-USDC buy
print; the minute's £18.9k was sells on the other side. A strict reading (entry ≤ the quantity printed strictly
through the quote on the side that takes it, in the fill minute) gives **+$0.964** for the nine trips. In the committed
history the effect is small: 97.1 % of the primary window's +$707.90 survives it (223 of 8,192 entries short) and
99.9 % of the post-change 28 days' +$11.67 (1 of 102). Exits likewise fill whole on any print through: the 22:45 exit of
the three USDT longs (300.7 USDT) had 66.1 USDT through it that minute; a strict exit would have completed at the same
price by 00:05:52 on 09-25 (cumulative 323.8 USDT), so no P&L changes here; in the post-change backtest 22 of 101 maker
exits had less through-volume in their minute than the position.

### 2.5 An honest interim reading (the test unchanged)

* Operationally the paper test is healthy and faithful to its spec, and the regime it was planned on (a 3–5 bp market)
  still holds. Nothing argues for stopping or changing it.
* Economically nothing is decided. Per trip ($0.120) and per FX-live day ($0.475) it runs at the backtest's post-change
  rates ($0.114 a trip, $0.554 a weekday); per calendar day it is at the bar ($0.254 vs $0.26), below the plan ($0.42),
  on 6 independent fill minutes.
* Power, from the post-change backtest (seen data): mean $0.417, SD $0.569 per calendar day (weekday mean $0.554, SD
  $0.611; per trip mean $0.114, SD $0.103). At 28 days the SE is $0.108 a day. If the backtest rate holds, the 28-day
  estimate clears $0.26 with probability ≈ 93 %; if the true rate is exactly $0.26, 50 %. To show "better than cash"
  (4 %/yr) at 80 % power needs ~24 days; "better than 8 %/yr" ~81 days. **So 10-21 can say "on plan or not", not "worth
  money with confidence"** (the live design's B1 said the same: 27 / 93 days).
* The dollars stay small whatever the reading: $0.42 a day on $1,200 is ~$150 a year; at the live path's £50 about $0.02 a
  day. The live path's value is measurement (what a real post-only order gets), not income.

## 3. PR5 arm candidates, ranked

Rules applied: the paper test stays frozen; an arm is separate and pre-registered; it must have prior evidence and a
plausible effect after costs. A useful fact: **the frozen rule's rungs and books are independent** (each rung has its own
order and position, and each may take up to 10 % of the minute's volume on its own), and **size never changes a
decision** (only the entry quantity, min(size, 10 % of volume); exits and stops close whatever is held). So any subset of rungs/books and any rung size is an exact re-reading of the paper
record — no forward arm needed.

| rank | candidate | prior evidence | how to test | power | worth it? |
|---|---|---|---|---|---|
| 1 | **PR5-W: weekend quotes** — the frozen rule while Yahoo is dark (Fri ~21:30 → Sun reopen), with X = Friday's last interbank close (or the coin-implied GBP/USD; choose before any P&L) | weekend prints 79 % (USDT) / 67 % (USDC) of weekday, volume 71 % / 63 % (post-change weekends, committed tape); weekend stable/GBP deviation ≈ weekday (first-principles item 22: mean \|dev\| 5.4 vs 5.5 bps); both books print through the weekend (09-26/27: USDT 146/136 prints, £97k/£130k) | a replay on PR5's stored inputs into its own tables (`agent_quote_prints` hold every weekend print, `agent_quote_inputs` the Friday close and every hourly candle, `agent_book_levels` the go-live books since 09-26), forward from its freeze; plus a backtest on the committed tape's weekends (~40) for the reopen tail, reported apart | ~3.8 trips per weekend day expected (weekday 3.1 USDT + 2.0 USDC × the print ratios) → 8 weekends ≈ 60 trips, $6.9 ± ~$1.6 before gaps; 8 reopens cannot price the gap tail (48 gaps: median 4.7 bps, p90 30.6, max 54.1; 5 over 30) — the backtest must | **yes, cheaply**: no venue call, no capital; upside ≈ +30 % of PR5's P&L (≈ +$0.15/day on $1,200). One weekend seen (Fri 21:40 → Sun 21:00, against Friday's close and the engine's own weekend fairU): USDT-GBP prints median −4.6 bps from that fair, range −44 to +6; USDC-GBP median −0.3, range −28 to +8 — centred on Friday's close, with tails far wider than the weekday 4 bp market, so fills may be one-sided and wait for Monday |
| 2 | **PR5-R: four pre-declared readings of the frozen record at 10-21** (not rules): (a) strict fills (2.4b); (b) the size ladder $25 / $300 / $1,000 by exact rescaling, also under (a); (c) the live path's own configuration — bids only until asks are funded, £4.17 rungs — as the live test's expectation; (d) the replay on recorded per-minute inputs (2.4a) | 2.4; the live path skips every ask today | computed from the same tables | n/a | **yes**, costs nothing, removes cherry-picking at the review |
| 3 | USDT-GBP only | USDT-GBP earned 2–7× USDC-GBP in each of ten months (primary +$576.66 vs +$131.24; post-change +$7.93 vs +$3.74 on equal capital, 17.2 vs 8.1 %/yr) | subset of the paper record | ~60 trips in 4 weeks | no: it drops a book still at ~8 %/yr; only worth it if capital binds, and it does not ($1,200) |
| 4 | bids only | post-change bids +$8.71 (61 trips) vs asks +$2.96 (41); paper 6 bids +$0.84, 3 asks +$0.24 | subset | — | **no**: the side that wins follows GBP/USD's drift over the hold (post-change GBP −221 bps; April +273 bps: asks $54.96 vs bids $29.18); over ten months bids $358 vs asks $350 |
| 5 | rung spacing (0.1 % only; a tighter 0.05 %) | post-change per trip 0.1 % $0.073 (70), 0.2 % $0.160 (20), 0.3 % $0.281 (12); each rung type 10.4–16.6 %/yr on its $400 | 0.1 %-only: subset; 0.05 %: a replay on stored prints | — | no: nothing says a tighter rung survives adverse selection (fp5: quoting near the touch loses on coin books); dropping 0.2/0.3 % loses dollars that clear 8 %/yr |
| 6 | a wider re-price step (0.10 / 0.20 %) | orders 205 → 69 → 33 a day for −23 % / −35 % P&L (live design, $50) | replay | — | no: the budget does not bind (max 441 a day in the backtest, 440 on paper; governor at 600/700) |
| 7 | inventory limits | 1 taker stop in 28 days (−$0.016), max drawdown $0.13; 0 stops on paper | — | — | no: nothing to fix |
| 8 | other books | USDC/EUR (PR7) is on the EEA side only (UK answers 400; no UK print in 366 days); USD books at par (PR6) failed and its pre-registration closes other rungs/sizes/guards there | — | — | no |

**PR5-W outline (for its pre-registration):** rule = PR5 frozen (`stepMinute` unchanged) with X(t) replaced, only while
X(t) is dark, by the last interbank close before the dark (Friday's; Christmas and New Year likewise), fair = fairU /
that X; exits at that fair; the 24-hour taker stop unchanged; entries withdrawn when the live X returns and the rung is
re-priced by the normal step. Data: stored prints and inputs only; post-only check from the last print (as PR5) and
reported against `agent_book_levels`. Arms: primary, stress (PR5's), and the coin-implied X as a descriptive
alternative only if fixed before any P&L. Null: PR5's random-time twins drawn from weekend traded minutes. Bar, over
≥ 8 weekends: P&L > 0 after the reopen losses (positions open at the reopen, marked at the first live fair, also
reported apart); above the null's p95; stress > 0; ≥ 60 round trips; no weekend over 40 % of the total; worth it as an
increment — the $1,200 is already locked for the weekday test and idle at weekends, so the weekend P&L annualised on it
must add at least 2 %/yr; and the backtest's weekends (2025-12 → 2026-09-20, frozen before computing) positive after
their reopen losses. Disclose: the counts above and the one weekend's price range (09-26/27) were seen.

**And before PR5's first live order (after 10-21, only on Davies' word):** freeze what the live test must show — fp5's
plan item 6, "each live fill against the paper engine's call for the same quote-minute". Per paper bid fill: did the
live order at the same rung fill, when, for how much, at what fee; per live fill the paper did not have (a print AT our
price reaching us in the queue, or the ~30 s placement lag), its markout. The paper makes about 3 bid fills a weekday
(61 in the post-change 28 days; 6 in 2.3 FX-live days on paper), so four weeks give roughly 50–60 paired fills: enough
to see a fill-rate ratio far from 1, not a shortfall of a basis point or two.

## 4. The RW family: where it stands, what 10-09 decides, and what to pre-register now

### 4.1 Status (allowed data only; SQL Q10–Q13)

| test | judged on | now |
|---|---|---|
| RW (Reward quotes) | 09-25 → 10-08, 14 days, six conditions | running: `last_minute` 21:48 at 21:50, no error. Closed days (running totals): 09-25 total +$148.09, stress +$28.05, rewards $203.62, 147 fills, capital $485.17, 15 markets; 09-26 +$219.72, stress −$28.53, rewards $375.70, 402 fills, capital $804.81, 20 markets. So day 2: +$71.64, stress −$56.58, rewards $172.08, 255 fills; fills marked −$55.53 and −$100.44 on the two days |
| RW-E (variant-1) | 09-27 → 10-08, 12 days, seven conditions | its first day is not closed yet; its 09-25/26 rows equal RW's to the last digit; `checkMaxUsd` $0.00, `diverged` empty, version 3, no error |
| x1–x3 (variant-2…4) | 09-28 → 10-08, 11 days, seven conditions | start 09-28 00:00; `checkMaxUsd` $0.00, `checkEMaxUsd` $0.00 over 2 days, version 2, no error; their 09-25/26 rows equal RW's |

Against RW's bar after 2 of 14 days: total > 0 yes; **stress > 0 no (−$28.53)**; ≥ 100 fills yes; concentration not
readable before 10-09; the bootstrap needs all 14 days; 4 %/yr is not binding at this capital. The ledger's aggregate
note of 09-27 17:28 put RW's running stress at −$136.07. The verdict will turn on conditions 2 and 4.

### 4.2 What the 10-09 verdict decides, and what it cannot

It decides: RW pass/fail (six conditions, after the replay and missed-print checks b and c); RW-E pass/fail (seven,
after its check); x1–x3 pass/fail (seven, after two checks); then a migration takes the four calls out of
`edge-calls-every-minute`; a live design only if RW or RW-E passes and only on Davies' word. It cannot show what
Polymarket actually pays (only a quoting account can), the queue at our price, how others react to our quotes, whether
14 days generalise, or whether this account may quote (fp4 §0: the Terms of Use bar UK and Irish residents "with no
exceptions"; Davies read that on 09-24 and chose to continue).

### 4.3 Follow-ups to pre-register now (before any data they would be judged on exists)

1. **A decision rule for the five arms (RW-NEXT part 1).** Five arms on overlapping days, the variants picked from 24
   configurations on two days, RW-E's split found on 1.7: choosing the best of five on the days that judge them is
   selection, and the variants' own pre-registration says condition 7 "alone proves nothing". Fix the choice now.
2. **RW-C, a 14-day forward confirmation (RW-NEXT part 2),** of whatever part 1 chooses, on days that do not exist yet,
   before any live design: RW's engine stops by constant at 10-09 00:00 (`RW_RUN_END`), so it needs a second engine
   instance with its own tables (a build, on Davies' word). Pre-registered now, it is clean.
3. **Fixed descriptive readings (RW-NEXT part 3)** that a live design needs and that nobody should choose after seeing
   the fills: the live capital (collateral of open quotes plus inventory, peak over minutes); fills also from prints AT
   our quote on the taking side — the at-price queue case the strictly-through rule omits, pessimistic because RW's fills
   lose money (−$55.53, −$100.44 on the two closed days); maker rebates by the published schedule, never in a bar; the
   split by category and horizon; minutes stored against minutes due.
4. **A pre-committed stop:** if RW and RW-E both fail and nothing passes, the line closes and no variant is tried again
   on 09-25 → 10-08.
5. Later, and only if something passes: a live reward-calibration pre-registration (actual payout against the formula
   for the same market-days), frozen before the first live order.
6. Lower: the narrower same-day rule RW-E's pre-registration names (stop quoting a temperature bucket once the station
   has decided it). If wanted, freeze it now and judge it on RW-C's days, not on 09-28 → 10-08 (x1 already removes
   weather bluntly on those days, and every added arm there widens the multiplicity).

### 4.4 Draft pre-registration (the best two in one file)

> **Pre-registration RW-NEXT: how the 2026-10-09 verdicts are read together, and a fourteen-day confirmation**
>
> Written <date> (UTC), before any minute of 2026-10-09 exists and before anyone has read a market-level figure of
> 2026-09-25 or later. Frozen by the commit that adds this file; any deviation is reported as a deviation. It changes
> nothing that runs and nothing in RW's, RW-E's or RW-X's pre-registrations.
>
> **Seen before the freeze (disclosed):** the aggregate columns of `pm_rw_days`, `pm_rw_e_days` and `pm_rw_x_days` for
> 2026-09-24 → 09-26 (09-25 +$148.09, stress +$28.05; 09-26 running +$219.72, stress −$28.53, 402 fills, capital
> $804.81); the replays' check fields ($0.00); the ledger's aggregate notes of 09-27. No market-level figure.
>
> **Part 1 — the choice, applied mechanically on or after 2026-10-09 00:05 UTC.**
> 1. Each arm is judged by its own pre-registration after its own checks; an arm whose check fails is void.
> 2. The candidate is RW-E if it passes all seven of its conditions; otherwise RW if it passes all six; otherwise none.
> 3. A variant (x1, x2, x3) replaces the candidate only if it passes all seven of its own conditions AND its day-by-day
>    stress beats the candidate's over 2026-09-28 → 10-08 in a paired bootstrap: the eleven (variant − candidate) daily
>    stress differences, 2,000 draws of eleven `choice`s with Python's `random.Random(20261010)`, sums sorted, the one
>    at index 100 > 0. Among several, the one with the largest stress total.
> 4. If there is no candidate but a variant passes its own seven conditions, that variant goes to Part 2 as a
>    hypothesis, never to a live design directly.
> 5. If nothing passes, the reward-quote line closes: no rule is tried again on 2026-09-25 → 10-08, and a new idea needs
>    a new mechanism and its own pre-registration.
>
> **Part 2 — RW-C.** RW's rule, selection ($300 of whole markets a UTC day by first-round reward per dollar), timing,
> fills, settlement and accounts exactly (`agents/pmrw.ts` unchanged), run forward by a second engine into its own
> tables for fourteen UTC days from the first 00:00 UTC after it deploys (target 2026-10-09 → 10-23), starting flat; its
> warm-up counts nowhere. RW-E and x1–x3 are replayed from its stored minutes by the frozen `pmrw_e.ts` / `pmrw_x.ts`
> rules with every "from" set to RW-C's first minute. The primary is the arm Part 1 names; the others are descriptive.
> Check before anything is read: the replay's `rw` arm equals RW-C's own day rows to under $0.01, or the result is void.
> Bar, all of, for the primary over its fourteen days: RW's six conditions (the bootstrap seeded `random.Random(20261023)`).
> Power, disclosed: two closed days give daily stress +$28.05 and −$56.58; at a daily stress SD near $60 a 14-day stress
> total has an SD near $225, so condition 2 is a point estimate that holds roughly 90–95 % of the time if the true mean
> is +$25 a day and 50 % if it is zero — not a significance test (28 days would narrow it by √2). Pass → the live-design question goes to Davies under
> Part 4. Fail → the line closes as in Part 1.5.
>
> **Part 3 — reported beside every bar, never part of it:** (a) live capital: the peak over minutes of the sum over
> markets of the collateral of the quotes resting that minute (N × b for a bid, N × (1 − a) for an ask) plus the cost
> of the inventory held; (b) fills-at-price: the arm's total when prints AT our quote on the side that takes it also
> fill, up to the remaining N, after the strictly-through prints; (c) maker rebates on the arm's fills by the market's
> published fee schedule and rebate share; (d) rewards, fills P&L and stress by category and by horizon; (e) the minutes
> stored against the minutes due, and what the missing minutes' markets paid on the days around them.
>
> **Part 4 — what any live step needs (not a test):** Davies' word; the order path only in `eu-west-1`, refusing unless
> `SB_REGION` is `eu-west-1`; positions opened only while his Ireland attestation (an expiring timestamp set in the
> conversation where he says so) is current, and otherwise reduce or close only — for a two-sided maker that means
> cancelling every quote that would increase |inventory|, so it earns only while he is in Ireland; never a VPN, a proxy
> or anyone else's account; `_shared/polymarket.ts` GET-only until the design is agreed; the Terms of Use bar (fp4 §0)
> stated in the design as his accepted risk, with close-only mode its named consequence; the wallet kept small (its key
> was exposed to another tool); a dry-run first, caps, a kill switch, reconciliation by order id, and the account's
> actual reward payouts read against the formula for the same market-days — the one thing no paper test can show.
>
> **What it cannot show:** what Polymarket pays; how other makers answer our quotes; more than fourteen days.

## 5. Other quote-style tests: none new

* The one quote-style line the evidence still supports is already on the plan: **a queue model on Revolut X's recorded
  stablecoin books** (fp5 item 5; `agent_book_levels` since 09-26, four weeks to ~10-24). PR6 failed with fills only on
  prints strictly through par ±1–3 ticks; on a pegged book a resting order is filled by its place in the queue, which
  nothing on record measured. Its pre-registration must be frozen before anyone reads that table: the queue rule (join
  at the back of the recorded level quantity, fill by prints at our price on the taking side; in the pessimistic arm
  every cancellation at our level comes from behind us, in the optimistic arm from ahead of us in proportion), the books (USDC-USD, USDT-USD,
  and PR5's two GBP books, where 8 of 9 paper fills rested behind the touch), fills at the limit, the venue's 0 % maker
  fee, a power check, a circular-shift null. It is also PR5's natural next question (join the touch vs rest 10–30 bps out).
* Why nothing else: quoting coin books loses to adverse selection (h/σ₁ₘ < 2.7 on every busy UK book, §3.28; fp5's
  touch quotes −15 to −35 bp a trip; maker-only rules §3.23 fail); Binance's zero-fee stablecoin books pay 1.4–2.6 %/yr
  with a losing stress arm (§3.26 PR2, §3.29 ZF); gold tokens on Revolut X clear h/σ only at weekends, one book at a
  time, on ~$34k a day (§3.29); the USD books at par fail 8 %/yr even with no stops (§3.35); EUR stablecoins are EEA-only
  (PR7). Polymarket's other maker incomes (rebates, 4 %/yr holding rewards) are cash-sized and belong inside RW's
  reading (Part 3c), not in a test of their own.

## 6. SQL and commands run (all SELECT; production project `flmvxigozjuizpckllvk`)

```sql
-- Q1 engine state (P1)
select last_minute, updated_at, last_error, now() from public.agent_quote_state;
-- Q2 per day and book (P2, plus stops and book snapshots)
select date_trunc('day', minute)::date day, book, count(*) filter (where kind='order') orders, count(*) filter (where kind='refused') refused,
  count(*) filter (where kind='withdraw') withdrawn, count(*) filter (where kind='fill') fills, count(*) filter (where kind in ('exit','stop')) exits,
  count(*) filter (where kind='stop') stops, count(*) filter (where kind='book') book_snaps
from public.agent_quote_events group by 1, 2 order by 1, 2;
-- Q3 round trips (P3)
select book, side, k, t_entry, fill_ts, fill_print_id, entry, qty, t_exit, exit, how, notional_usd, pnl_usd from public.agent_quote_trips order by t_entry;
-- Q4 minute record: coverage, inputs, lateness
select date_trunc('day', minute)::date, book, count(*), count(x), count(fair_u), min(hours_n), max(hours_n), sum(prints_n) from public.agent_quote_minutes group by 1, 2;
select date_trunc('day', minute)::date, percentile_cont(0.5) within group (order by extract(epoch from recorded_at - minute)),
  percentile_cont(0.99) within group (order by extract(epoch from recorded_at - minute)), max(extract(epoch from recorded_at - minute))
from public.agent_quote_minutes where book = 'USDT-GBP' group by 1;
-- Q5 the fair lag: engine fair_u against the median of the stored closes in [t-24h, t-1h], with and without the newest/oldest close
with m as (select book, minute, fair_u::float8 fair_u, hours_n, case when book='USDC-GBP' then 'fair:USDC-USD' else 'fair:USDT-USD' end kind
           from public.agent_quote_minutes where minute >= '2026-09-25 00:05' and extract(minute from minute)::int between 1 and 58),
win as (select m.*, i.value::float8 v, row_number() over (partition by m.book, m.minute order by i.t) rn_old,
               row_number() over (partition by m.book, m.minute order by i.t desc) rn_new
        from m join public.agent_quote_inputs i on i.kind = m.kind and i.t >= m.minute - interval '24 hours' and i.t <= m.minute - interval '1 hour'),
agg as (select book, minute, fair_u, percentile_cont(0.5) within group (order by v) med_full,
               percentile_cont(0.5) within group (order by v) filter (where rn_new > 1) med_no_newest,
               percentile_cont(0.5) within group (order by v) filter (where rn_old > 1) med_no_oldest from win group by 1, 2, 3)
select book, count(*), count(*) filter (where abs(fair_u/med_full-1) > 1e-9), count(*) filter (where abs(fair_u/med_no_newest-1) > 1e-9),
  count(*) filter (where abs(fair_u/med_no_oldest-1) > 1e-9) from agg group by book;
-- (and the same over all minutes for the 0.5-bp counts; and the order-price version over kind='order', what in ('place','reprice'),
--  recomputing floor/ceil(fair*(1∓k)/1e-4) exactly as quoteTicks/exitTicks — 0 mismatches with the engine's own fair)
-- Q6 X revisions: agent_quote_minutes.x against agent_quote_inputs(kind='fx', t = x_t)
-- Q7 go-live acceptance of each fill: latest kind='book' snapshot naming the fill's oid/side/k/leg='entry', ticks vs best bid/ask
-- Q8 strict size: per trip, sum(qty) of prints strictly through the entry (exit) price on the taking side in the fill (exit) minute
-- Q9 regime: adjacent opposite-side prints within 60 s, (buy-sell)/mid, median per ISO week (diagnostics.py's definition)
-- Q14 dry-run: L1 (keys at,why,held,armed,posts,dryRun,guards,minute,governor,dayPnlGbp,entryBook,lossStopped only — not balances/account),
--  L2, L3, L4, L5 exactly as reference §4 item 35; paper bid entries vs dry-run entries per day and book
-- Q10 RW family day rows, aggregate columns only
select 'rw', null, day, total, stress_total, reward, fills, capital, markets, closed_at from public.pm_rw_days
union all select 'rw_e', arm, day, total, stress_total, reward, fills, capital, markets, closed_at from public.pm_rw_e_days
union all select 'rw_x', arm, day, total, stress_total, reward, fills, capital, markets, closed_at from public.pm_rw_x_days;
-- Q11 states: last_minute, updated_at, last_error, top-level key names
-- Q12 check scalars only
select state->'checkMaxUsd', state->'version', state->'dayOf', jsonb_array_length(state->'diverged') from public.pm_rw_e_state;
select state->'checkMaxUsd', state->'checkEMaxUsd', state->'checkEDays', state->'version' from public.pm_rw_x_state;
-- Q15 one weekend's GBP-book prints against Friday's-close fair (level statistic for PR5-W's pre-registration; no rule, no fill)
with fr as (select 1.324643611907959::float8 x),
f as (select book, percentile_cont(0.5) within group (order by fair_u::float8) fu from public.agent_quote_minutes
      where minute >= '2026-09-25 21:40' and minute < '2026-09-27 21:00' group by book),
p as (select book, min(price::float8) lo, max(price::float8) hi, percentile_cont(0.5) within group (order by price::float8) med
      from public.agent_quote_prints where ts >= '2026-09-25 21:40' and ts < '2026-09-27 21:00' group by book)
select p.book, (p.lo/(f.fu/fr.x)-1)*1e4, (p.hi/(f.fu/fr.x)-1)*1e4, (p.med/(f.fu/fr.x)-1)*1e4 from p join f using (book), fr;
-- Q13 pg_net and ops_errors
select status_code, timed_out, count(*), min(created), max(created) from net._http_response where created > now() - interval '72 hours' group by 1, 2;
select kind, date_trunc('day', created_at)::date, count(*) from public.ops_errors where created_at > '2026-09-23 15:00'
  and (kind ilike '%quote%' or kind ilike '%rw%' or kind ilike '%books%') group by 1, 2;
```

Local scripts (scratchpad `research/`, none in the repository): `pr5_diag.py` (post-change 28 days: daily and per-trip
moments, strict entry, exits short of through-volume, by book/rung/side/weekday/hour), `pr5_diag_primary.py` (strict
entry on the primary window: 97.1 %), `pr5_sides.py` (bids vs asks by month with GBP/USD's monthly move),
`weekend_counts.py` (prints and volume, weekday vs weekend; counts only), `fx_gaps.py` (48 GBP/USD dark-stretch gaps
from the committed Exness series), `candle_probe*.sh` (keyless GET of `/api/1.0/public/candles/USDT-USD?interval=60`
every 10–20 s from 21:59:50 UTC).
