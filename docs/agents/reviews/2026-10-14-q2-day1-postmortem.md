# Q2-PM: why Q2 lost on its first live day, and what would have done better

Research only (2026-10-14, about 02:40–03:25 UTC). Q2 has been live since 2026-10-13 13:25:32 UTC (live-prep's Addenda
19, 20 and 21) and keeps running; nothing live was changed. Every database read was a read-only `select`, and every
Polymarket read was keyless. Scripts and outputs are in `docs/agents/backtests/lpbest/`:

- scripts: `scripts/q2pm_data.py` (the work folder), `scripts/q2pm.py` (the steps `check`, `live`, `run`, `prog`, `opt`);
- SQL: `sql/q2pm_live.sql`;
- outputs: `results/q2pm_check.txt`, `q2pm_live.txt`, `q2pm_run.txt`, `q2pm_prog.txt`, `q2pm_opt.txt`;
- the manifest: `MANIFEST_q2pm.json`.

LP-BEST's and Q2-AGE's files stay as they were. Not blind: the watch's figures were read first.

Davies, 2026-10-14, verbatim: "你仔细研究下为什么还在亏，可以优化吗？" (look carefully at why it is still losing; can it be
optimised?).

The window is **2026-10-13 13:26 → 10-14 01:59 UTC (12.6 hours)**. That is the restart's first picks to the last hour
pm-rec's archive had closed when this ran. Live figures past 01:59 are not in it.

## The answer in plain words

- **Most of the loss came from the refills.** When a pick's reward rate dips under the $10 floor, live hands its slot
  to a market from the reserve after 15 minutes, and never takes the pick back that day. LP-BEST never priced this: its
  engine kept each pick all day and only stopped entries during a dip. In this window:
  - 5 of the 7 markets that filled were refills;
  - they lost $8.10 of the $10.67 fills loss.

  Over the eight recorded days the same rule costs **−$2.27 a day [−$2.88, −$1.59], on all 8 days**: +$3.37 a day
  keeping the picks, against +$1.09 with live's refills.
- **The engine got the fills right. It overstated the rewards about 1.9×.** On the same picks and the same schedule as
  live:
  - fills: engine −$9.91, live −$10.67;
  - rewards: engine $2.94, live about $1.55.

  The biggest leak on the reward side is x2's 15 ¢ pause. Live judges it on the others' book in thin, flickering quiet
  books, so it trips 13 times as often as the engine's: 380 minutes against 29. Those minutes carried 30 % of the formula
  the engine expected.
- **The window was bad even by the engine's own reckoning.** The engine, quoting the live picks as LP-BEST designed
  (all day, no refills), loses −$1.57 here. Its 8-day average would have made about +$1.76 over a span this long. The
  rest of the gap is the refills and the reward shortfall.
- **The programmes move all day for every market. It is Polymarket, not us.** On the day's quiet candidates:
  - the rate changes about every 14 minutes;
  - 89–98 % of the candidates dip under $10 at some point in a day;
  - about half of all reads are under $10.

  Every config's `start_date` is today (89 of 95 read). It was the same on TRAIN and TEST. After our joins, the rate
  fell *less* than in the day's other quiet candidates.
- **Verdict: change one thing, Addendum 22 below: no refills (`PM_LP_REFILL.maxPerDay` 10 → 0).** A pick whose rate dips
  keeps its slot. It rests its exits, takes no entry while the rate is under the floor, and quotes again when the rate
  comes back. That is exactly what LP-BEST priced. Calibrated to live day 1, Q2 then reads:
  - **+$1.47 a day [−$0.65, +$3.72]** with the pause as live trips it;
  - +$2.39 [+$0.27, +$4.72] if the pause tripped no more than the engine's;
  - 1.53 ¢ of rewards a filled share, against the 1.5 ¢ bar.

  As live runs now, it reads **−$0.74 a day [−$3.12, +$1.66]**: it does not clear $0. Nothing tried clears $0 and the
  1.5 ¢ bar with confidence. Stopping is the alternative if Davies wants no further risk: the stop has $15.37 of room,
  and the day-14 bar needs about +$8.5 back.

## 1. The live record (`results/q2pm_live.txt`)

### The picks

| | |
|---|---|
| 13:26 picks | 12 |
| refills on 10-13 | 9, ranks 13–21, all of them between 13:50 and 17:35 |
| 00:00 picks on 10-14 | 12 |
| refills on 10-14 | 4, by 01:49 |

Of the 12 first picks, 7 were replaced, the first 24 minutes after selection (0x9938610f…, OpenRouter, at 13:50). At
13:26 the selection found only 14 quiet books among 60 reads.

### Selected pick-minutes, by what rested

| | minutes | share |
|---|---:|---:|
| nothing resting: touch under 4 ¢ | 3,648 | 40.3 % |
| out: rate under the $10 floor (480 of them with an exit resting) | 3,037 | 33.6 % |
| resting both sides | 798 | 8.8 % |
| resting one side | 767 | 8.5 % |
| paused | 380 | 4.2 % |
| nothing resting, other (an order in flight, unrecorded) | 192 | 2.1 % |
| the restart's first 17 minutes, gates closed | 181 | 2.0 % |
| programme ended | 32 | 0.4 % |

Total: 9,048 minutes.

### Rewards

| | |
|---|---|
| formula (the live code's), 10-13 | $1.241 |
| paid for 10-13 | $0.892 (R 0.719) |
| rebates for 10-13 | $0.618 |
| formula, 10-14 to 01:59 (not paid yet) | $0.909 |
| minutes with both sides scoring | 329 on 10-13, 116 on 10-14 |

### Fills

There were 19 fills, 349 shares, all as maker. In YES terms, at the cleaned book:

- 11 inside the others' touch, 6 at it, 2 behind;
- by LP-SPEED's classes: 14 D (one taker took our price), 4 B (sweeps), 1 C (behind the touch);
- markouts: −$8.92 at 1 minute, −$2.72 at 5 minutes, −$2.60 at 60 minutes.

The loss is immediate: one-shot takers at our improved price. That is LP-SPEED's finding again, and no faster loop
changes it.

Each market at the window's last mid:

| market | | P&L | realised |
|---|---|---:|---:|
| 0x397bea1f… | refill | −$3.00 | |
| 0xe612eb64… (PG) | 00:00 pick | −$2.80 | −$2.80 |
| 0xed1eabc9… | refill | −$2.80 | |
| 0x40b8e1cc… | refill | −$1.00 | |
| 0x750ce9d6… | refill | −$0.90 | |
| 0xd95404d1… | refill | −$0.40 | |
| 0x3b162968… | 10-14 pick | +$0.23 | |
| **total** | | **−$10.67** | **−$6.00** |

The watch's −$12.25 was marked later and at another mid.

Against the 1.5 ¢ bar:

- rewards alone: 0.26 ¢ a filled share;
- with rebates: 0.43 ¢.

## 2. The engine on the same window, line by line (`results/q2pm_run.txt`)

The work folder is LP-BEST's pipeline re-run to 10-14 01:59. It reproduces LP-BEST's Q2 to the cent: +$3.61 a day
[+1.38, +6.02] (`q2pm_check.txt`). With Addendum 21's exits in a one-tick book, the rule live runs, it is +$3.37. The
engine ran the live picks two ways: as designed (each day's 12, all day) and as run (each pick from its selection to its
replacement, the refills where live took them).

| over the 12.6 h | total | rewards | formula | fills | rebates | shares | fills | both-sided min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| engine, as designed | −1.57 | 2.706 | 6.442 | −4.57 | 0.300 | 174 | 12 | 896 |
| engine, as run | −6.37 | 2.939 | 6.995 | −9.91 | 0.604 | 332 | 18 | 851 |
| live | −8.51 | 1.545* | 2.150 | −10.67 | 0.618 | 349 | 19 | 445 |

\*10-13's payout, plus 10-14's formula to 01:59 at live's R 0.719.

**The gap, assumption by assumption, in dollars over the window.** It adds up exactly.

| step | $ | what it is |
|---|---:|---|
| LP-BEST's Q2 average for 12.6 h | +1.76 | +$3.37 a day × 0.524 days |
| the window itself | −3.33 | the engine on the live picks as designed. Fills −4.11 against the average, rewards +0.61, rebates +0.18 |
| **refills (programme changes, as live handles them)** | **−4.80** | as run against as designed. Fills −5.34, rewards +0.23, rebates +0.30; the shares filled almost double, 174 → 332 |
| **rewards: the engine over live** | **−1.39** | split below |
| fills: the engine's fill model | −0.76 | −9.91 against −10.67 on the same schedule, within one fill's noise |
| rebates | +0.01 | |
| **live** | **−8.51** | |

**The rewards gap of −$1.39**, by live's state that minute. The engine's paid is shared out by its stateless formula in
the minutes its gate allowed entries; live's paid by live's own formula.

| live's state | engine $ | live $ | gap |
|---|---:|---:|---:|
| paused (x2's pause) | 0.89 | 0.02 | **−0.87** |
| out: rate under the floor, read every minute (the 15-minute listing still read ≥ $10) | 0.40 | 0.01 | −0.39 |
| nothing resting, other (an order in flight, unrecorded) | 0.31 | 0 | −0.31 |
| resting both sides, Polymarket scoring neither or one | 0.44 | 0.18 | −0.26 |
| the restart's 17-minute closed gate | 0.19 | 0 | −0.19 |
| resting one side | 0.13 | 0 | −0.13 |
| no row | 0.03 | 0 | −0.03 |
| resting both sides, both scoring | 0.54 | 1.34 | **+0.80** |

Where both sides scored, quiet books paid live *more* than the engine assumed. R was 0.72 on live's formula, and the
engine's per-minute formula there was 0.7× live's.

**Quoting minutes, engine against live** (section 1 of the output):

- The engine's own gate agrees with live on the 4 ¢ touch in 3,600 of the 3,648 minutes live sat under it.
- It agrees on a programme dip in 2,445 of the 3,069 minutes live had one.
- It disagrees on the pause: 380 minutes live, 29 in the engine.

Replaying x2's pause on live's own rows reproduces live's 380 minutes exactly (section 6). The cause is wide quiet books
whose far side is a thin level 20–60 ¢ away:

- When our own order is the only one near the touch, the others' size-adjusted mid swings by more than 15 ¢ from one
  minute to the next. For example, 0x6eed2a46… read 0.22/0.90 for one minute at 00:28; 0x7465aead… flicked between
  0.37 and 0.72 asks.
- The engine misses these swings. pm-rec keeps only the levels within 10 ¢ of the touch, and in about 12 % of the minutes
  our order rested, the engine's "cleaned" book still holds our own order: 595 of 4,860 resting sides, read from live's
  rows. So the engine cannot price the live pause.

The rule "a jump that still stands a minute later" would pause 212 minutes instead of 380, but keeps 2.0 of the 2.7 of
formula in them.

**One switch at a time on the as-run schedule** (section 4, $ over the window):

| | $ |
|---|---:|
| Q2 as run | −6.37 |
| no pause | −6.15 |
| pause stops entries only | −6.37 |
| pause on the raw mid | −6.51 |
| touch ≥ 3 ¢ | −6.09 |
| touch ≥ 5 ¢ | −2.72 |
| touch ≥ 6 ¢ | −2.36 |
| no touch rule (TB1) | −8.66 |

## 3. The programmes (`results/q2pm_prog.txt`)

These are pm-rec's listing reads, every market every 15 minutes, 15.6 M reads from 10-04 19:00 to 10-14 01:59. They are
used rather than `pm_prog_reads`, which is the paper programme factor's table (36,580 rows, 10-04 19:11 → 10-13 01:59,
off since `0120`).

**Within a UTC day, per market-day:**

| set | days | market-days | moved | changes a day (median) | ≥ 10 changes | dipped under $10 | reads under $10 | ended under half |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| every market ≥ $10, N ≤ 50 at 00:00 | TRAIN | 8,456 | 73 % | 5 | 44 % | 42 % | 19 % | 28 % |
| | TEST | 8,798 | 73 % | 12 | 52 % | 45 % | 19 % | 27 % |
| | 10-13 | 2,100 | 73 % | 7 | 47 % | 44 % | 18 % | 24 % |
| Q2's quiet candidates | TRAIN | 204 | 96 % | 19 | 71 % | 89 % | 53 % | 55 % |
| | TEST | 221 | 100 % | 28 | 91 % | 98 % | 51 % | 53 % |
| | 10-13 | 53 | 100 % | 32 | 89 % | 96 % | 49 % | 58 % |
| Q2's picks (the engine's) | TRAIN | 36 | 86 % | 20 | 69 % | 72 % | 42 % | 56 % |
| | TEST | 36 | 100 % | 32 | 86 % | 97 % | 49 % | 61 % |

- **Live's minute reads agree.** 469 changes in 14,610 market-minutes, a median of 14 minutes between changes. The rates
  went up as well as down: PG read 10 → 41 → 20 within eight hours.
- **A dip under $10 lasts a median of 72–75 minutes.** Of 1,884 dips on the listing, 17 % were back within 15 minutes,
  45 % within an hour and 68 % within four; 15 % were still under at the day's end. Live's 55 dips read the same.
- **Daily re-issue.** The CLOB's `/rewards/markets/{condition_id}` for 96 markets at about 03:13 UTC: 89 of 95 configs
  start today, 5 yesterday, 1 earlier, one config a market. Polymarket re-issues each programme daily. Whether the
  config's id carries over was not checked across days.
- **Not us.** For each of 90 live joins since 10-08 (a market's first live order of a day, its rate ≥ $10), the
  listing's rate 1, 2 and 4 hours later was compared with the day's other quiet candidates at the same minute:

  | | 1 h | 2 h | 4 h |
  |---|---:|---:|---:|
  | ours | −24 % | −29 % | −49 % |
  | the others | −33 % | −46 % | −57 % |
  | difference (log) | +0.13 [−0.03, +0.28] | +0.27 [+0.09, +0.43] | +0.15 [−0.07, +0.37] |
  | dipped, ours | 16 % | 24 % | 39 % |
  | dipped, the others | 28 % | 47 % | 68 % |

  It is the same in both strata of where the rate stood against its own last 24 hours. Rates fall after any moment you
  pick a market for being ≥ $10, because that picks a high point. They fall less in the markets we quote.
- **Did TRAIN/TEST have it, and did the engine price it?** Yes, it was there all along. The engine priced it as LP-BEST's
  Q2 was designed: a dip stops entries while it lasts (the 15-minute listing). It never priced live's handling: out
  after 15 minutes, replaced, and not taken back. That handling is Addendum 13's refill, which predates Q2. LP-BEST's
  draft did not carry it into the priced rule.

## 4. The candidates (`results/q2pm_opt.txt`)

Each candidate is Q2's policy at $316, through the engine, with the market-day bootstrap.

- **The record:** 10-05 → 10-12, $ a day, with TRAIN (10-05 → 10-08) and TEST (10-09 → 10-12).
- **Live day 1:** 10-13 00:00 → 10-14 01:59, 26 hours, on the 00:00 day tables. The live picks of 13:26 cannot be
  re-selected.
- **The refill rule:** "live" refills a pick out 15 minutes from the reserve's order and does not take it back; "keep"
  is LP-BEST's model.
- **"calib":** rewards × 0.53, live's paid over the engine's on the as-run window; fills and rebates as the engine has
  them.
- **"cal np":** rewards × 0.76, the same if live's pause tripped no more than the engine's.
- **c/sh:** rewards at the calibrated R per filled share.

| candidate | raw $/day [5 %, 95 %] | TRAIN | TEST | calib [5 %, 95 %] | cal np | c/sh | day 1 raw |
|---|---|---:|---:|---|---:|---:|---:|
| **Q2 as live** (refills, no retake) | +1.09 [−1.30, +3.52] | +1.46 | +0.73 | −0.74 [−3.12, +1.66] | +0.15 | 1.36 | −7.10 |
| **keep the picks (LP-BEST's Q2) = refills 0** | **+3.37 [+1.19, +5.78]** | **+3.55** | **+3.18** | **+1.47 [−0.65, +3.72]** | **+2.39** | **1.53** | −6.39 |
| refills 5 | +1.26 | +1.91 | +0.62 | −0.54 | +0.33 | 1.42 | −7.28 |
| refills 20 (the reserve runs dry: = 10) | +1.09 | +1.46 | +0.73 | −0.74 | +0.15 | 1.36 | −7.10 |
| refill after 60 minutes out | +2.49 | +2.56 | +2.43 | +0.43 | +1.43 | 1.53 | −7.08 |
| re-take a pick whose rate comes back | +1.26 | +1.46 | +1.06 | −0.59 | +0.30 | 1.32 | −7.10 |
| only programmes stable 1 d (≥ 90 % of reads ≥ $10) | −0.57 | +0.04 | −1.19 | −0.85 | −0.72 | 1.27 | −0.27 |
| stable 2 d | −0.31 | +0.38 | −1.00 | −0.53 | −0.42 | 1.25 | 0 (none) |
| stable 3 d | +1.18 [+0.47, +2.08] | +0.38 | +1.98 | +0.99 | +1.08 | 2.20 | 0 (none) |
| stable 1 d ≥ 75 % | −2.20 | −1.64 | −2.75 | −2.94 | −2.58 | 1.28 | +1.08 |
| rank RW × P(survive 24 h) | −0.20 | +0.49 | −0.89 | −2.24 | −1.25 | 1.30 | −3.15 |
| rank at the 24 h mean rate | −1.29 | +0.43 | −3.01 | −3.23 | −2.29 | 1.25 | −2.73 |
| rank at the mean rate × P(survive) | −1.91 | −0.54 | −3.27 | −3.67 | −2.82 | 1.22 | −4.76 |
| pause stops entries only | +3.36 | +3.55 | +3.16 | +1.46 | +2.38 | 1.53 | −2.73 |
| pause on the raw mid | +3.46 | +3.57 | +3.35 | +1.56 | +2.48 | 1.53 | −6.39 |
| no pause | +1.58 | +0.87 | +2.29 | −0.46 | +0.53 | 1.40 | −7.64 |
| touch ≥ 3 ¢ | +1.39 | −1.37 | +4.16 | −0.89 | +0.21 | 1.15 | −7.29 |
| touch ≥ 5 ¢ | +1.65 | +1.20 | +2.09 | +0.12 | +0.86 | 1.57 | −1.99 |
| touch ≥ 6 ¢ | +1.88 | +1.44 | +2.31 | +0.47 | +1.15 | 1.72 | **+7.46** |
| 6 markets | +2.46 | +2.48 | +2.45 | +1.30 | +1.86 | 1.52 | −0.63 |
| 8 markets | +2.73 | +2.91 | +2.56 | +1.34 | +2.02 | 1.58 | −9.96 |
| entries while the rate ≥ $5 | +3.43 | +3.84 | +3.01 | +1.47 | +2.42 | 1.49 | −6.39 |

All but two rows are "keep" with one change; the two refill rows are the live rule with one number changed.

What the table says:

- **Keeping the picks beats live's refills on every recorded day.** Paired, +$2.27 a day [+1.59, +2.88] (8 of 8 days),
  and +$0.71 over live day 1. The refill gets more markets into the book, and in quiet books more markets means more
  one-shot fills. The reserve is thin: 23 refills in 8 days, 8 on day 1. Any refill allowance costs money, and waiting
  60 minutes only halves the cost.
- **Stability filters leave almost nothing.** Almost every quiet programme dips within a day. "Stable 3 days" keeps 9
  shares a day for +$1.18. Ranking by survival or by the mean rate pushes Q2 into busier books, and fills fall to
  −$4.8 to −$5.9 a day.
- **The pause cannot be judged here.** The engine trips it 13 times less often than live does. Its pause protects on the
  record: removing it costs −$1.79 a day. Exits through the pause are neutral on the record and +$3.66 on day 1. The
  live pause's cost is real, since it forgoes about 30 % of the formula, but no variant priced here regains it safely.
- **The touch stays at 4 ¢.** It is the best on TRAIN. Day 1 favours 6 ¢ (+$7.46 over the 26 hours), but that is one
  day against TRAIN, and it is noted for the day-14 read.
- **Fewer markets:** 6 and 8 earn less on average. They lose less on a bad day, which is only the same bet made smaller.
- **Clearing $0 and 1.5 ¢:**
  - raw, LP-BEST's Q2 clears both on the record (5 % bound +$1.19);
  - calibrated to live day 1, nothing clears $0 at its 5 % bound except "stable 3 d" (+$0.29), which barely trades,
    and "keep" with a pause that trips like the engine's (+$0.27);
  - LP-BEST's Q2 sits at 1.53 ¢ against the 1.5 ¢ bar;
  - Q2 as live does not clear $0 at its 5 % bound in any reading.

## 5. Verdict and the proposal

**Change one thing: Addendum 22, no refills.**

The change:

- In `supabase/functions/agents/pm_lp.ts`, `PM_LP_REFILL` (lines 195–197): `maxPerDay` goes 10 → 0. Its pin in
  `pm_lp.test.ts:1190` moves with it.
- Add a pin that a slot out on the floor is never replaced while `maxPerDay` is 0. It fails on today's constant.
- Nothing else moves:
  - the reward check (Addendum 9) still stops entries in a minute whose rate is under $10, and the exits still rest;
  - the market quotes again the minute the rate is back;
  - the backstop, the loss guard, the pause, the touch and the −$25 stop stay.
- The refill block in `pm_live.ts` (lines 3011–3105) and `pm_lp_reserve` stay in place. A refill only for a programme
  that has *ended* would need code there, and it is not worth it: 32 minutes on day 1.

What it is worth:

- **Raw engine:** +$2.27 a day over today's rule on the record, every day. That is the difference between Q2 as live
  (+$1.09) and Q2 as LP-BEST priced it (+$3.37).
- **Calibrated to day 1:** −$0.74 → +$1.47 a day.

What it does not fix:

- **The adverse fills.** That is the quiet-book bet itself.
- **The pause leak**, roughly $0.9 of rewards over the window (about $1.7 a day at day 1's rate). A pause that ignores a
  one-minute flicker regains only a quarter of it. It is better studied on the live rows after day 7 than changed now.
- **R.** It was measured on one day (0.72).

**The alternative is to stop.** The 14-day bar needs ≥ $0 from the restart. Live stands at about −$8.5, with $15.37 of
stop room. At the calibrated +$1.47 a day, the change expects to recover in about 6 days, but the range includes
losing days of −$10 (the record's worst day is −$9.85). Unchanged, the calibrated −$0.74 a day means the bar is not met
and the stop is likely to trip. **Continuing as is is the one option the evidence rules out.**

As always, the addendum is Davies' word to give. No pre-registration or frozen file is touched by this study.

## 6. What this did not check

- **Live after 01:59.** pm-rec's archive closes hourly. 10-14's payout and rebates were not yet read, so 10-14's rewards
  are the formula at day 1's R.
- **Day 1 is one draw.** The calibration factors (× 0.53, × 0.76) come from 12.6 hours and 445 both-sided scoring
  minutes. The fill model's agreement (−$9.91 against −$10.67) is one window. The ranges given are the market-day
  bootstrap and do not include the calibration's own uncertainty.
- **The engine's cleaned book still holds our own order in about 12 % of resting sides.** That understates the touch
  rule's and the pause's bite in markets we quoted. On the record (10-05 → 10-12) it touches only the markets live-prep
  quoted then.
- **The day-1 candidate span** uses the 00:00 day tables. The 13:26 restart selection cannot be rebuilt from them, so its
  picks differ from live's.
- **The "nothing resting, other" minutes** (192) were not traced to their cause in the orders table.
- **The CLOB's start dates** were read once (about 03:13 UTC). Whether a config's id carries over between days was not
  checked.
