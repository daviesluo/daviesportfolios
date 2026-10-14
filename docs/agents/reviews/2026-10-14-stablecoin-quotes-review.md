# Stablecoin quotes, LIVE and every test row: one basis, variant-2 taken apart, what to change (2026-10-14)

Davies, 2026-10-14: "审核和研究一下目前所有的live和testing的stablecoin quotes策略，所有数据都可以看，我看variant-2比stablecoin
quotes表现好不少？有可以优化live策略的地方吗？目前测试策略中有可以删除/修改/优化/新增的地方吗？"

**Not blind, and no reading.** Every record was read for research (there is no no-peek rule since 2026-10-04). No
pre-registered reading was run or pre-empted: PR5's verdict (10-21), the twins' readouts (10-21, after 10-28), PR5V and
rule D (10-28), QUEUE (11-02), TAKE (window to 11-02, at most 11-30), Coinbase's two tests (11-08, 11-10) and PR5-W (11-25)
run as their pre-registrations say, and each result file should name this review, with the 2026-10-09 one
(`reviews/2026-10-09-stablecoin-quotes-review.md`), as a further non-blind read of their records. Nothing was changed in
production, no order was placed or cancelled, and no code, migration or frozen file was edited: every change below is a
proposal.

**Sources.** Production read 2026-10-14 04:01–04:12 UTC, SELECT only. Everything is in
`docs/agents/backtests/scq_review/2026-10-14/` (`MANIFEST.json`): the pulls (`sql/pull_orders.sql` → `data/`), every
aggregate with its output (`sql/aggregates.sql`, cited below as [H1]…[X1]), the page's own money by its own functions
(`scripts/page_pnl.ts` → `results/page_pnl.json`: `liveRungs`, `liveRungTrips`, `liveCoinBooks`, `liveBookGbp` from
`agents/index.ts`), the comparisons and bootstraps (`scripts/compare.py` → `results/compare.json`, seed 20261014,
10,000 resamples of whole weekdays) and the £0.10 prints (`scripts/dust.py` → `results/dust.json`). "Now" is 2026-10-14
04:02 UTC. Trips are counted by their entry time unless a line says otherwise; a "lit" day is a weekday (PR5 is dark
from Friday ~21:30 to Sunday 23:00 UTC, [X1]).

## 0. Answer first

1. **Variant-2 is better per pound, not in pounds, and most of the gap is its size, not its rule.** On the page
   "Stablecoin quotes" has made more (£8.53 realised on £1,200) than variant-2 (£5.72 on £600); per pound of capital
   variant-2 leads, 0.95 % against 0.71 % (17.8 % against 13.2 % a year). Scaled to the same £50 a rung, variant-2 is
   £1.46 ahead over the whole record. Of that: **£1.05 (72 %) is size** — variant-1, PR5's rule unchanged at £50 a rung, is
   just as far ahead of "Stablecoin quotes"; **£0.21 (14 %) is TAKE's rule** (five takes, +£0.29, less the one maker trip a
   take displaced, £0.09); **£0.19 (13 %) is the simulator's timing**, one exit on 10-13 that variant-1 had refused and
   variant-2, turning a minute later, did not. The size effect is beyond noise over every weekday (+£0.075 a day at £50,
   90 % interval +0.028 to +0.131); TAKE's rule alone is not (+£0.030 a day, −0.014 to +0.083; 15 % of resamples at or
   below zero), on five takes, none since 10-08.
2. **LIVE tracks its twin.** Per pound of rung, LIVE minus "Stablecoin quotes" over LIVE's weekdays is +£0.001 a day at
   £50 a rung (−0.117 to +0.114). Since 10-09, of 444 decisions both carried out, the twin's 9 real fills were all LIVE
   fills too, and LIVE had one more. LIVE makes 9.7 % a year on its capital since 10-04 16:00, against 7.8–11.5 % for the
   twins. Nothing in it is broken: no venue refusal since 10-02, no dead-man trip since 10-07, nothing pending.
3. **But LIVE is down overall once its coins are marked.** Realised +£0.28, unrealised −£0.37 (its £70 of USDC and USDT
   bought at about 0.757 and worth 0.7525–0.7533 now): −£0.09 in all. That is GBP/USD, not the strategy; every twin
   carries the same (−£0.90 to −£3.23).
4. **For LIVE, the one big lever is size, at the 10-21 verdict.** Everything else measured here is small, unproven, or
   already being read by a pre-registered test (TAKE, PR5-W's weekend, rule D). No defect fix is needed in LIVE.
5. **New for the 10-21 verdict: PR5's paper engine logged 714 orders on 2026-10-01**, over the spec's condition 5 ("at
   most 700 orders on every day"), on the count `agent_quote_days` keeps ([P1]).
6. **The twins pay a penny each way on the £0.10 prints that LIVE does not** (a counterparty has traded exactly £0.10 at
   the touch about 450 times a day since 10-08): −£0.22 in each of `pr5`, `p50`, `take50` and −£0.96 in `d`, none in LIVE
   since F1's fix. The readouts should state it; nothing should change mid-window.
7. **Testing:** keep all four twins and both Coinbase tests to their dates. After 10-21, stop "Stablecoin quotes" (`pr5`):
   its question, £100 against £50 a rung, is answered. After 10-28, stop variant-3 (`d`) unless rule D passes, which its
   record so far argues against. Add nothing now.

## 1. Every row on one basis

### 1a. The whole record (the page's own figures)

| row | from | capital, rung | trips (won / stops) | realised | bps a trip | per £ of rung | % of capital | a year | worst day (by exit) | fees | coins held (cost) | unrealised |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIVE | 10-01 16:29 | £120, £10 | 70 (53 / 3) | **£0.2768** | 5.7 | 0.0277 | 0.23 % | 6.7 % | 10-01 −£0.0188 | £0.0840 | £70.59 | −£0.3662 |
| Stablecoin quotes (`pr5`) | 09-23 15:09 | £1,200, £100 | 92 (72 / 3) | £8.5341 | 12.0 | 0.0855 | 0.71 % | 13.2 % | 10-13 −£0.3103 | £0.2100 | £708.52 | −£1.9641 |
| variant-1 (`p50`) | 09-23 15:09 | £600, £50 | 106 (84 / 3) | £5.3115 | 12.3 | 0.1066 | 0.89 % | 16.5 % | 10-13 −£0.0740 | £0.1100 | £353.15 | −£0.9008 |
| variant-2 (`take50`, TAKE) | 09-23 15:09 | £600, £50 | 112 (88 / 3) | £5.7240 | 12.5 | 0.1147 | 0.96 % | 17.8 % | 10-05 −£0.0635 | £0.3400 | £353.15 | −£0.9005 |
| variant-3 (`d`, rule D) | 09-28 00:00 | £1,800, £50 × 36 | 468 (311 / 11) | £13.1707 | 6.9 | — | 0.73 % | 16.6 % | 10-14 −£0.0355 | £0.4717 | £1,059.77 | −£3.2326 |

Realised, fees, coins and unrealised are the page's (`results/page_pnl.json` `page`); trips, bps, per £ of rung and the
year are from the trips (`results/compare.json` `rows.*.all`; their sum differs from realised by under £0.02, the coins
the asks hold). "A year" is the record's pounds over its capital, scaled from its calendar days (LIVE 12.5, twins 19.6,
`d` 16.1). The twins' records before 2026-10-02 21:05 are their backfills (in sample). Per £ of rung is not given for `d`:
its 36 rungs share its capital differently. LIVE's fees are the two go-live taker conversions (£0.0540, 10-01) and three
bounded 24-hour stops (£0.01 each, 10-08); every quote fill since has been a maker's 0 %. The twins' fees are their stops
and, in `take50`, the five takes' 0.09 % (£0.23).

### 1b. The same dates

Trips entered from LIVE's first minute (2026-10-01 16:29:53, 12.5 days, 10 lit weekdays) and from TAKE's start
(2026-10-04 16:00, 9.5 days, 8 lit weekdays) to now (`results/compare.json` `rows.*.since_live`, `since_take`):

| row | from LIVE's start: trips, £ | per £ of rung | per lit day per £ of rung | a year | from TAKE's start: trips, £ | per £ of rung | a year | from 10-09 16:00: trips, £ |
|---|---|---|---|---|---|---|---|---|
| LIVE | 70, £0.2765 | 0.0277 | 0.0028 | 6.7 % | 60, £0.3042 | 0.0304 | 9.7 % | 28, +£0.0638 |
| Stablecoin quotes | 50, £3.1293 | 0.0313 | 0.0031 | 7.6 % | 44, £2.4401 | 0.0244 | 7.8 % | 17, −£0.0637 |
| variant-1 | 55, £1.7632 | 0.0353 | 0.0035 | 8.6 % | 48, £1.3942 | 0.0279 | 8.9 % | 20, +£0.0383 |
| variant-2 | 61, £2.1657 | 0.0433 | 0.0043 | 10.6 % | 54, £1.7967 | 0.0359 | 11.5 % | 21, +£0.2431 |
| variant-3 | 294, £5.8456 | — | — | 9.5 % | 260, £4.6043 | — | 9.8 % | 92, +£0.4935 |

LIVE's first span carries the go-live conversions' £0.054 and the 10-02 stall, as known. The last four days (10-09 16:00
on) were poor for every row: 10-12 was quiet and 10-13 had two losses no rule caused, a refused exit held five to eleven
hours while fair fell (§3c) and the £0.10 prints' pennies in the twins (§3d). Without the £0.10-print trips the twins'
last four days read `pr5` +£0.0635, `p50` +£0.1659, `take50` +£0.3709.

### 1c. The engines behind the page, and Coinbase ([P1], read only for this review)

| engine | record | to now | from LIVE's start | note |
|---|---|---|---|---|
| PR5's paper test (USD, $100 rungs) | 09-24 → | 126 trips, 119 won, **+$11.7806** ($0.61 a day, 18.5 % a year on $1,200) | 71, +$4.1212 | the spec's condition 3 asks $0.26 a day; condition 5, see below |
| PR5V `main` = rule D `v1` | 09-28 → | 553 trips, +$22.9550 each, equal to the cent | 383, +$7.5990 | rule D's precondition holds |
| rule D arm `d` | 09-28 → | 573 trips, +$22.2581 | 405, +$8.0444 | **$0.70 behind `v1`** over the whole record; its condition 3 needs `d` ahead day by day |
| PR5V `top5` | 09-28 → | 347 trips, +$18.0776 | — | |
| Coinbase "with Euros" (£1,200 + €1,200) | window 10-11 → 11-08 | 10 trips, 8 won, +£0.5748, all on the EUR books (10-12/13) | — | three lit days; nothing to read yet |
| Coinbase "with Euros - 2" | window 10-13 → 11-10 | 2 trips, +£0.0851, the same two as "with Euros" | — | identical until its first weekend, 10-16/18, as designed |

**Condition 5 of PR5's spec reads "at most 700 orders on every day"; the paper engine's own daily view counts 714 on
2026-10-01** (orders a day: 09-24 440 … 09-30 535, 10-01 714, 10-02 575, 10-08 591, 10-13 233; [P1]). The spec says a
breach "is a finding to fix (for example a wider re-price step), not a pass". Whether the 10-21 verdict counts orders the
way `agent_quote_days` does is for its script; this is said now so that it is not a surprise on 10-21. LIVE itself is
unaffected: its own governor (900 / 950 POSTs) has not bound since 10-07, and it sent 211–295 rows a weekday since 10-09
([L1]).

## 2. Variant-2 against "Stablecoin quotes"

**What variant-2 is.** Variant-1 (PR5's paper decisions carried out at £50 a rung on a simulated account) plus one thing
from 2026-10-04 16:00: when the recorded book is already through a rung's price by more than the 0.09 % taker fee, it
takes that price at once with an IOC (paying 0.09 %) instead of waiting to be filled as a maker. Exits are unchanged:
the same maker exit at fair, the same re-price step, the same 24-hour stop. "Stablecoin quotes" is the same decisions at
£100 a rung with no takes. So the two differ in two ways, size and TAKE, and variant-1 sits between them.

**Taken apart** (`results/compare.json` `take_vs_p50`; variant-2 − variant-1 on the page £0.4125, on the trips £0.4026):

| part | £ | what |
|---|---|---|
| the takes | +0.2926 | 5 take trips, all USDT-GBP: 10-05 (bid 0.1 % and 0.2 %, −£0.0318 each), 10-06 (ask 0.1 %, +£0.1485), 10-08 (bids, +£0.1005 and +£0.1071). Fees £0.23 in them |
| what they displaced | −0.0862 | variant-1's maker trip on the same rung on 10-06 (USDT-GBP ask 0.1 %) |
| the twins' timing | +0.1911 | 33 of 105 common trips differ; £0.1902 of it is one event: on 10-13 06:50 variant-1's USDC-GBP bid exits at 0.7558 were refused (the book's bid had reached them); variant-2, whose turn waits for the book recorder's next read (its pre-registration's Deviation 1), placed 0.7557 at 06:51, which rested and filled at 07:28. Variant-1's rungs sold at 0.7542–0.7543 at 18:25 |
| other | +0.0050 | two small trips only variant-2 made |

**Is it beyond noise?** Paired day bootstraps on whole weekdays, each row scaled to £50 a rung (`compare.json`
`bootstraps`, `takeRuleOnly`):

| comparison | weekdays | mean a day (£, at £50 a rung) | 90 % interval | resamples ≤ 0 |
|---|---|---|---|---|
| variant-2 − Stablecoin quotes, every weekday (09-24 → 10-13) | 14 | +0.104 | +0.052 to +0.160 | 0.0001 |
| variant-1 − Stablecoin quotes, every weekday (**size alone**) | 14 | +0.075 | +0.028 to +0.131 | 0.0008 |
| variant-1 − Stablecoin quotes, TAKE's weekdays (10-05 → 10-13) | 7 | +0.025 | −0.006 to +0.054 | 0.096 |
| variant-2 − variant-1, TAKE's weekdays | 7 | +0.058 | +0.002 to +0.116 | 0.041 |
| **TAKE's rule alone** (takes less what they displaced) | 7 | +0.030 | −0.014 to +0.083 | 0.149 |

So: the size effect is real over the record but was concentrated in the wide days (09-28 alone +£0.40 at £50 a rung,
10-01 +£0.24); since 10-05 it is small. Variant-2's lead over variant-1 looks significant (4 %), but half of it is the
one timing event, which is the simulator, not the rule; the rule alone is +£0.21 in seven weekdays and not
distinguishable from zero. TAKE's pre-registered bar needs 15 take trips (C1); it has 5, none since 10-08 05:53 ([T1]),
so its window is likely to extend toward 11-30.

**Why a smaller rung earns more per pound.** The twins fill a resting order by the size of the prints through it. Of
their fills of £1 or more, `pr5`'s entries filled 90.7 % of their size and `p50`'s 94.4 %, and `p50` made 93 entry fills
to `pr5`'s 80 on the same decisions: a partly filled £100 rung holds a position longer and misses the next entry. LIVE at
£10 filled 49 of 49 entries whole. This is how the venue works too (a £60 taker fills £60 of a £100 order), so the size
effect is not a simulator artefact, though the twins' rule (a print strictly through, never one at our price) makes
every fill rarer than LIVE's.

**What is simulator, not rule.** Three things move the twins apart from each other or from LIVE:

- **S1, the £0.10 prints** (§3d): each costs a twin about £0.02 (£0.11 paid for £0.10 of coin, £0.09 received back),
  LIVE nothing. It costs `pr5`, `p50` and `take50` the same pounds (£0.22, £0.22, £0.23), so it does not touch TAKE's C4,
  but it understates the smaller rungs per pound (4 bps of a £50 rung against 2 of £100).
- **S2, fills only through.** The F3 replay found variant-1 makes +£6.83 instead of +£5.28 to 10-09 when a print at the
  order's own price fills it (`backtests/scq_f3/results/summary.json`); LIVE gets such fills (§3a).
- **S3, turn timing.** Variant-2's turns wait for the book recorder; its re-prices land in other minutes than
  variant-1's, so exits differ on trips no take touched (+£0.19 here). TAKE's C4 (variant-2 − variant-1 over trips opened
  in the window) includes this noise; its reading should report C4 with and without the common trips whose exits differ,
  as a descriptive line beside the bar (the bar itself cannot change).

## 3. LIVE against its twin and its paper engine

### 3a. Tracking

- **The same decisions** ([L3]): of 2,712 entry decisions both LIVE and `pr5` carried out, real fills (more than 0.2
  coins): LIVE 38, twin 31, both 28; LIVE only 10 (6 of them USDC-GBP bids, fills at our own price that the twin's rule
  never counts), twin only 3. Since 10-09 16:00: 444 decisions, LIVE 10, twin 9, both 9.
- **Per pound** (§1b, and `compare.json` `bootstraps`): LIVE − `pr5` at £50 a rung, LIVE's 8 weekdays: +£0.001 a day
  (−0.117 to +0.114); LIVE − `p50`: −£0.021 (−0.127 to +0.078). LIVE is inside the twins' noise.
- **Against the paper engine**: since LIVE's start the paper engine made 71 trips, +$4.12 at $100 rungs (£0.31 at £10
  a rung) against LIVE's £0.28; the gap is the conversions' £0.054 and the 10-02 stall, as reported on 10-09.

### 3b. Everything that stopped or cost LIVE something ([L1], [L2], [L4], [L5])

| what | count | since 10-09 16:00 | cost |
|---|---|---|---|
| venue refusals | 14 (10-02: the top-ups and the double-counted coin, fixed that day) | 0 | none since |
| post-only orders refused at the book, never sent | 26 (20 entries, 6 exits) | 2 entries, 2 exits | entries: the rung waits for the next decision (median 33 min); exits: §3c |
| dead-man cancels | 48, all 10-07 (the storm, fixed that day) | 0 | — |
| stale paper engine (no entries) | 248 minutes, almost all 10-07 | 2 minutes (10-12 18:31, the paper engine's lease call) | — |
| de-peg guard | 19 minutes, 10-08 16:17–16:36 (the venue episode) | 0 | — |
| 24-hour stops | 3 (10-08 02:56–03:01) | 0 | +£0.0189 together |
| asks skipped for want of coin | 58 | 1 | the ask waits for a top-up |
| governor (900 / 950 POSTs) | not reached since 10-07 (951 rows that day) | max 295 rows a day | — |
| conversions | 2 at go-live (taker, £0.054) + 3 maker top-ups (10-02 ×2, 10-14 02:11, £0.34 of USDT, 0 %) | 1 | £0.054 in all |
| `ops_errors` for the quotes | 10-07 storm, 10-08 venue episode | 1 (`agents.quotes`, 10-12 18:31) | none |

### 3c. Refused exits wait for a print, and in a quiet book that can be hours

An exit is refused (never sent) when the book's own price has already reached it: for a sell, the best bid is at or above
our ask. The executor then does what PR5's paper rule does: it sends the exit again only after a newer print that is not
through it. On USDC-GBP a print can be hours away. On 10-13 the bid rungs' exits at 0.7558 were refused at 06:50 in LIVE
and in `p50` and `pr5`; LIVE's next exit went out at 11:47 and sold at 0.7549 at 15:12, the twins' at 0.7542–0.7543 at
18:25 ([L5]).

Priced against filling at the refused price ([L5]): `pr5` 24 refused exits cost £1.11 over its record (13 % of its
realised), `p50` 29 cost £0.46, **LIVE 6 cost £0.0066 net** (4 later sold better, 2 worse; £0.0238 since 10-09, all
10-13). The obvious fix, taking the bid at once with an IOC, would pay 0.09 %: £0.009 a LIVE exit and £0.045 a £50 one,
more than the average refused exit cost (LIVE £0.0011, `p50` £0.016). **So waiting is right on average; nothing to
change.** It is the main reason the twins' worst days are worse than LIVE's.

### 3d. The £0.10 prints

From 2026-10-08 one counterparty trades exactly £0.10 at the touch, buying and selling in turn: 221 of 470 UK prints on
10-08, then 402–484 a day, weekends included ([D1]). Each order is sized to £0.10 at the price it meets (0.13264 USDT at
0.7539, 0.13266 at 0.7538). When one meets our resting entry, the rung holds 0.13 coin, withdraws the rest of the entry,
and exits the 0.13; the rung quotes no entry until that exit fills.

| row | £0.10-print trips | what they made | at their orders' prices, no pennies | rung-minutes held |
|---|---|---|---|---|
| LIVE | 22 (13 since 10-09) | −£0.0186 (since 10-09 +£0.0010) | +£0.0022 | 444 |
| `pr5` | 13 | −£0.2180 | +£0.0014 | 1,311 |
| `p50` | 14 | −£0.2198 | +£0.0017 | 1,319 |
| `take50` | 15 | −£0.2320 | +£0.0016 | 1,375 |
| `d` | 62 | −£0.9565 | +£0.0040 | 3,846 |

(`results/dust.json`.) LIVE's cost was the three pre-F1 buy-backs (£0.0207, fixed 10-09); since then the venue fills
LIVE at exactly £0.10 each way. The twins fill by the print's own size at our price (0.13266 × 0.7539 = £0.100013, a
debit rounded up to £0.11) and sell the 0.13 back for a credit floored to £0.09 ([D1]), so they lose about £0.02 a trip
that LIVE does not. That is a gap between `revx_sim.ts` and the venue for a counterparty that sizes in pounds; it biases
every twin's readout against it, `d` most (7 % of its realised). The paper engine is unaffected (its £0.10 trips made
+$0.0000 to +$0.0002 each, [P1]). The time a rung is held is small for LIVE (444 rung-minutes in 12 days) and nothing
shows it cost a real fill: LIVE's real fills since 10-09 are a superset of the twin's.

### 3e. Bugs

None in LIVE. In the twins, S1 above (a simulator defect for pound-sized prints; frozen code, so a disclosure in each
readout, not a mid-window fix). Nothing else: every `_sim` and `_state` row has no error, `paperCheck` reads 46 / 46 / 46
/ 0, K1 holds (3,360 orders each side, none apart; [H2]).

## 4. LIVE: what to change, ranked

| # | change | evidence | £ effect | risk | the honest path |
|---|---|---|---|---|---|
| 1 | **Size: £50 a rung (£600)** rather than £10 | LIVE earns what the twins earn per pound (§3a); per pound £50 rungs beat £100 rungs (+£0.075 a day at £50, 90 % +0.028 to +0.131, every weekday; smaller since 10-05) | at variant-1's 8.6–8.9 % a year: about £52 a year on £600, against about £8–12 on £120 now; £100 a rung would earn about a fifth less per pound | the coins: about 59 % of the capital is USDC/USDT, so GBP/USD moves it (33 bps a day, the 10-09 review's F2): about ±£1.2 a day at £600, and −0.6 % since 10-01 (LIVE −£0.37 on £70 now) | Davies' call at PR5's 10-21 verdict; a config change on his word and the sub-account funded by him (never trading by hand in it) |
| 2 | TAKE's rule live | 5 takes, +£0.21 net in 7 weekdays, not beyond noise (§2) | +£0.03 a day at £50 a rung if it holds; nothing at £10 (TAKE's own pre-registration: a penny is 10 bps there) | a take pays 0.09 % at once; two of five lost | TAKE's reading (window to 11-02, extended to 11-30 until 15 take trips), then a pre-registered change on his word, only at £50 a rung or more |
| 3 | Weekend quoting on a held GBP/USD (Euros - 2's idea) | Revolut X's books trade at weekends: £89k and £116k of prints over £0.11 on 10-10/11 against £75k–£400k a weekday ([D1]); PR5 is dark Fri ~21:30 → Sun 23:00 | unknown on Revolut X; Coinbase's in-sample +34–47 % | a held rate is up to 60 h old; a Monday gap moves fair at once | PR5-W already tests exactly this (reading 2026-11-25, at the latest 12-23); its freeze line stands; adopt only after a pass, pre-registered |
| 4 | Exit handling after a refusal | §3c: LIVE £0.0066 net over 6 | none worth having: an IOC costs more than the average refusal | — | no change |
| 5 | Rung weights (drop or shrink the 0.3 % rungs) | the 0.3 % rungs made 7 of `pr5`'s 92 trips but £2.03 of its £8.53 (24 %), all on wide or disturbed days (09-24, 09-28, the 10-07 stall, the 10-08 venue episode) | negative | — | no change |
| 6 | TrueFX (a faster GBP/USD) | the fast-X study (`reviews/2026-09-28-pr5-fast-fx-study.md`): with the governor lifted −$0.003 to +$0.065 a day on four keys, no interval excludes zero; the stale fills it removes made +$0.01 in 28 days | about £0 at £10 a rung | another feed to fail | not recommended; if ever, as the ledger says, a pre-registered change of LIVE after 10-21 |
| 7 | Governor 900 / 950 | not reached since 10-07; ≤ 295 rows a weekday since 10-09 | none | — | no change |

Not a change but worth saying each time LIVE is read: judge it on realised beside the coins' mark. Since go-live the mark
(−£0.37) is bigger than the realised (+£0.28), and that will stay so until GBP/USD comes back or the edge outgrows it
(the 10-09 review put that at about a year at £10 a rung). Never trade by hand in PR5's sub-account (key `_2`): its
executor books that account's balance as its own.

## 5. TESTING: delete, modify, add

| row | now | proposal | why | what stopping it loses (reading, date) | the exact change |
|---|---|---|---|---|---|
| Stablecoin quotes (`pr5`, £100) | healthy | **keep to 10-21, then stop** | its question (£100 against £50 a rung) is answered in `p50`'s favour per pound (§2); after 10-21 it repeats `p50`'s decisions at twice the size | its descriptive readout beside PR5's verdict (twins' pre-registration §9, 10-21); nothing after | a migration after the readout: `update public.agent_quote_twin_specs set enabled = false where id = 'pr5';` (tables and record kept; the call and the page read enabled rows only); a deviation line in `reviews/2026-10-02-pr5-realistic-twins-prereg.md`, the reference's twin table and the ledger |
| variant-1 (`p50`, £50) | healthy | **keep** | TAKE's comparator (C4) to 11-02 (11-30 at most), and `d`'s after 10-28 | C4 of TAKE (11-04 onward) would be void | none |
| variant-2 (`take50`, TAKE) | healthy, K1 holds, 5 of 15 takes | **keep to its reading** | the only test of taking; pace suggests extension toward 11-30 | TAKE's reading (window end + 2 days) | none now; at its reading report C4 with and without the common trips whose exits differ (§2, S3), as a descriptive line |
| variant-3 (`d`, rule D) | healthy | **keep to 10-28, then stop unless rule D passes** | rule D's arm `d` is $0.70 behind `v1` over its record, and its condition 3 needs it ahead day by day; its four keys need more POSTs than one account has | its readout after rule D's reading (10-28) | after the readout: `update public.agent_quote_twin_specs set enabled = false where id = 'd';`, with the same three lines |
| Stablecoin quotes with Euros | 3 lit days, +£0.57 | keep | reading 11-08 | — | none |
| Stablecoin quotes with Euros - 2 | identical so far, by design | keep | first weekend 10-16/18; reading 11-10 | — | none |
| PR5's paper engine, PR5V, rule D, QUEUE, PR5-W | healthy | keep | 10-21, 10-28, 11-02, 11-25; the Coinbase tests read PR5's stored GBP/USD to 11-10 | each its own reading | none |

**Modify:** nothing mid-window. Each readout of the twins (10-21, after 10-28, TAKE's) should state S1 (§3d) with its
pounds, which `scripts/dust.py` gives on any later pull.

**Add:** nothing now. Considered and not proposed: a £10-a-rung twin (LIVE already tracks the twins within noise, §3a); an
exit taken at once after a refusal (it costs more than it saves, §3c); a weekend twin on Revolut X (PR5-W is that test);
re-weighted rungs (the outer rungs carry the wide and disturbed days, §4 row 5). After 10-21, if Davies picks a size for LIVE, the
twin at that size is the one to keep.

## 6. What this review did not check

- The PR5 verdict's own order count: whether its script counts `agent_quote_days.orders` (714 on 10-01) or something
  else is not settled here.
- No replay was run: the twins' figures are their records, and the "at the refused price" and "no pennies" figures are
  indicators from the orders' own prices, not re-simulations (a refused exit re-sent at once might not have filled).
- The book recorder (`agent_book_levels`) was not read: why TAKE has not triggered since 10-08 is not measured.
- Coinbase was read only for its trips and days (three lit days); its first-days review is `reviews/2026-10-12-coinbase-first-days.md`.
- No venue data outside the database was fetched; the £0.10 counterparty's identity and purpose are unknown.
- The GBP/USD path behind the marks was not re-measured beyond the tickers' index prices at 04:01 UTC.

## 7. In plain words (for Davies)

- Variant-2 looks better because it uses £50 a step instead of £100. Smaller steps fill more completely and more often,
  so each pound works harder. Its own trick, buying at once when the price is already good, has added about £0.21 in a
  week from five trades; that is promising but could still be luck, and it has not triggered since 10-08.
- Of variant-2's lead, about three quarters is the step size, one seventh is its trick, and one seventh is a quirk of the
  simulation's timing on one day.
- LIVE does what its paper twin does, pound for pound. Nothing in it is broken.
- LIVE is slightly down (−£0.09) once the coins it holds are priced, because the dollar fell against the pound since
  1 October; the trading itself made +£0.28.
- The biggest improvement for LIVE is its size, your decision at the 10-21 verdict: £50 a step would make about five
  times what it makes now, with more exposure to the dollar.
- Someone has been trading exactly £0.10 at a time about 450 times a day since 8 October. LIVE handles it at no cost; the
  test versions lose a penny each way on it, so they look a little worse than reality.
- The paper test that decides on 10-21 went over its 700-orders-a-day limit once, on 1 October (714). Worth knowing
  before the verdict.
- Keep every test to its date; after 10-21 the £100 version can go, and after 10-28 variant-3 probably can too.
