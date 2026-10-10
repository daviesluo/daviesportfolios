# LP-REFILL: how live-prep should refill a slot, and how to hold its losses

Research only (2026-10-10, written 13:41–15:10 UTC). No live path, config or migration changed. Every database read
was a read-only `select`. No order was placed or cancelled. Everything is in `docs/agents/backtests/lp_refill/`, and
its `MANIFEST.json` lists every script, input and output. Nothing here is applied: Davies decides. Every record read
here had been read before, so nothing here is blind.

Davies, 2026-10-10, verbatim:

> 现在就做补选吧，不然资金利用率太低了，研究出一套最合理的机制，你说的亏损还没控制你研究下

Then, about the candidates:

> 这个候补名单也要在当天中实时更新比如每分钟之类的

In English: do the refill now, or too little of the money works. Work out the most reasonable mechanism, and research
the losses that are still not under control. Then: the reserve must be kept up to date through the day, every minute
or so.

Addendum 13 put a refill live at about 14:00 UTC, while this research ran (`PM_LP_REFILL` in `pm_lp.ts`, commit
`b84cec4f`). Its live reserve is re-ranked every 5 minutes, and it refills a slot after 15 minutes out, at once when no
slot quotes, ten a day. That setting is priced below as **A13**, beside the alternatives.

## Verdict

- **A refill is worth having, and the cap of ten a day must stay.**
  - Every refill tested with a cap of ten a day beats no refill on the mean.
  - It removes the minutes with no slot quoting: 89 a day with no refill, 0 with any refill.
  - Without the cap, the live re-rank loses most of its gain. A13's rule earns $5.65 a day uncapped, against $17.53
    with ten a day.
- **A13 as deployed** earns $17.53 a day at R 0.47 (simulator units; 0.81 live). Against no refill that is +$6.37,
  bootstrap [−5.19, +17.61], ahead on 3 of 5 days. Its worst day is −$19.09, against −$37.94 with no refill.
- **A13 has a cost the mean hides: its refills fill the $300 cap with inventory, and its reward then collapses.**
  - Held at the day's close, A13 carries $253–$338 from the first evening on.
  - Its formula reward goes $76.5, $5.4, $19.3, $4.9, $0.0 a day over 10-05..10-09, and $0.0 on the partial 10-10.
  - With no refill the same days earn $23.9, $14.5, $24.4, $26.1, $12.7 and $25.2.
  - On 10-06..10-09 that is $7.4 a day for A13 against $19.4 for no refill. A13's net holds up only through fills,
    which were a windfall on 10-07.
  - All nine live re-rank settings tested (every 5, 15 or 60 minutes; after 0, 15 or 60 minutes out) do the same: by
    10-08 their formula is $0–$14 a day.
- **A reserve ranked once at 00:00 keeps earning.** Its programme is still checked each minute; only the ranking is
  fixed for the day.
  - Settings: refill after 15 minutes out, ten a day, a reserve of 30.
  - Net: $16.26 a day, +$5.10 [−3.97, +13.24] against no refill, ahead on 4 of 5 days.
  - Formula: $25.9 a day. On 10-06..10-09 it is $20.4 a day, and $25.4 on the partial 10-10.
  - Held at close: $157–$288.
  - Worst day: −$27.18.
- **The recommendation is therefore:**
  - Keep A13's machinery.
  - Re-rank the reserve once a day, at the 00:00 selection, rather than every 5 minutes (`rerankEveryMin: 1440`).
  - Keep the per-minute programme read of its first candidates (`refreshTop`). That is the part of "every minute"
    the record supports: a candidate whose programme ended is skipped.
  - Every other number stays as deployed.
- **Loss guard: no new buy in a market whose fills are marked $10 down** (buys only; sells still rest; it lifts if the
  mark recovers).
  - On the record it costs nothing: +$0.47 a day on no refill, +$0.12 on A13, −$0.01 on the 00:00 reserve.
  - On the live episodes it halves the loss. Live-prep's own 10-09/10-10 selections, replayed:
    - MrBeast wk1 loses $8.95 instead of $36.91.
    - The book's fills lose $17.66 instead of $44.31.
    - The two days' net at R 0.47 is $73.08 instead of $50.08.
  - Its level is on a slope. $7.5 costs $3.98 a day on no refill and $9.91 on A13; $5 costs $11.62 and $13.36. $10
    is the lowest level that is free on the record. Do not set it lower.
- **Every other guard was priced and is not proposed.**
  - No buys within 24 or 48 hours of the end costs about $15.5 a day, though it saves the most on MrBeast.
  - A smaller side cap inside or outside a 0.2–0.8 band costs $4–$11.
  - A mid-move pause and a drift stop come out about $0, and mixed across settings.
  - A one-way stop (4 fills on one side, 240 minutes) helps with no refill (+$1.88 [+0.60, +3.16]) but costs $4–$8 on
    a live refill.
  - Leaving count markets out costs $19.52.
- **Capital stays at about $300.** At $400 every setting earns less than at $300, as LP-ALLOC found.
- **Expected with the recommendation:** the 00:00 reserve, 15 minutes, ten a day, and the $10 guard.
  - Net: about $16.3 a day at R 0.47. It is $10.0 at R 0.23 and $19.1 at R 0.58.
  - Against no refill: +$5.10 [−3.97, +13.24].
  - Worst day: −$27.18. Mean capital $248 of $300.
- **Nothing here is out of sample.** The guard's level was chosen on these days. A13's own numbers were set before this
  record was read, so its row is the nearest thing to a pre-specified arm. 10-05 and 10-07 are windfall days for every
  setting.

## Method

- **The record:** LP-ALLOC's full-universe builder (`../lp_alloc/scripts/build.ts`), re-run on the pm-rec archive.
  - Window: 2026-10-05 00:00 → 10-10 13:00 UTC.
  - Size: 7,756 minutes, 2,135 markets, 4,056,394 book rows, 67,147 prints.
  - Live-prep's own live orders through about 13:40 UTC are taken out of the books.
  - The record (`pr_record.json`, sha256 `833cb052…c237`) is not committed (it is large). The steps that rebuild it are
    in `MANIFEST.json`.
- **The rule:** live-prep's rule as it stands, in `scripts/refill_sim.ts` (LP-ALLOC's `alloc_sim.ts` plus the refill
  family and the guards).
  - RW's quote, a 5N side cap, TB1's skip, x2's 15¢/60-minute pause, the 8% near-certain limit.
  - $100 a market and a $300 total cap. The −$75 stop.
  - The reward check: the programme as the listing showed it each minute; a market off is close-only and earns
    nothing.
  - AI markets out. Ten markets and $200 of first quotes at 00:00.
- **Fills:** at price, the model that reproduced live-prep's first live day (69 of 1,216 against 70 of 1,219). Strict
  fills are shown beside.
- **Rewards:** R is in simulator units. 0.47 is live-prep's 0.81 on its own formula (LP-ALLOC's calibration); the band
  is 0.38–0.58 and the stress case 0.23.
- **Days:** five full days, 10-05..10-09. The partial 10-10 (to 12:59 UTC) is shown apart.
- **Bootstrap:** paired over days, 2,000 draws, seed 20261010, 5th–95th percentile.
- **Refill sources in the simulator:**
  - `reserve00`: the 00:00 ranking past the day's ten (20 or 30 kept), each candidate's programme read at the minute it
    is taken.
  - `liveN`: every market the record holds, ranked by RW's first-round score on its latest book under its programme
    then, every N minutes, keeping 30 past today's markets (A13's `reserveSize`).
  - `fresh2h`: the freshest 2-hour slot ranking.
  - `reselect`: LPRESEL6's 6-hour or 2-hour re-selection.
- **When a slot counts as out:** in the simulator, its programme is off for `offN` minutes running, or (`allOut`) no
  slot's programme pays. A13 also counts a market out while it simply does not quote (a tight-book skip, a pause). The
  simulator does not, so live will refill a little more often than modelled. The ten-a-day cap bound on every day in
  every capped setting (10.0 refills a day), so the count of refills is the same either way.
- **Guards** act on buys only: a mid move against the side over N minutes; k fills in a row on one side; no buy within
  X hours of the end; a smaller side cap outside a band; and a per-market marked fills loss of $Y.
  - The marked loss is realised plus held at the record's adjusted mid, per market, from its first fill.
  - Rewards are not counted in it.
  - It is not latched: it lifts if the mark recovers.

## Refill: what each mechanism earns

At-price fills, $300. Net is $ a day at R 0.47 over 10-05..10-09; "vs none" is the paired bootstrap. Formula is $ a
day before R; held is at the day's close. Full tables: `results/analysis.txt` (stages `refill`, `final2`, `deployed`).

| setting | net | R 0.23 | strict | vs none [5–95%] | ahead | worst | formula | formula 10-06..09 | held | 0-slot min/day |
|---|---|---|---|---|---|---|---|---|---|---|
| no refill | 11.16 | 6.28 | 11.22 | — | — | −37.94 | 20.3 | 19.4 | 157 | 89 |
| **A13 as deployed** (live5, 15 min, 10/day, 30) | 17.53 | 12.44 | 27.87 | +6.37 [−5.19, +17.61] | 3/5 | −19.09 | 21.2 | 7.4 | 292 | 0 |
| live5, 15 min, uncapped (reserve 20) | 5.65 | 1.61 | 1.69 | −5.51 [−35.14, +20.76] | 2/5 | −23.31 | 16.8 | — | 297 | 0 |
| live5, 0 min, 10/day | 18.95 | 14.50 | 16.03 | +7.79 [−6.19, +25.93] | 3/5 | −26.58 | 18.5 | — | 288 | 0 |
| live5, 60 min, 10/day | 24.74 | 16.92 | 30.38 | +13.58 [−0.62, +26.00] | 4/5 | −19.26 | 32.6 | — | 259 | 0 |
| live15, 0 / 15 / 60 min, 10/day | 12.45 / 22.51 / 27.17 | — | — | +1.29 / +11.35 / +16.01 | 3/3/4 of 5 | −26.84 / −11.68 / −12.86 | 17.1 / 20.3 / 32.1 | — | 299 / 293 / 259 | 0 |
| live60, 0 / 15 / 60 min, 10/day | 13.84 / 25.53 / 14.09 | — | — | +2.68 / +14.37 / +2.93 | 3/3/3 of 5 | −21.55 / −16.37 / −14.31 | 15.5 / 27.3 / 23.4 | — | 288 / 272 / 282 | 0 |
| **reserve00, 15 min, 10/day, 30** | 16.26 | 10.04 | 16.90 | +5.10 [−3.97, +13.24] | 4/5 | −27.18 | 25.9 | 20.4 | 199 | 0 |
| reserve00, 0 min, 10/day, 30 | 17.86 | 11.73 | 19.86 | +6.70 [−2.01, +15.09] | 4/5 | −27.20 | 25.5 | 19.8 | 206 | 0 |
| reserve00, 5 / 60 min, 10/day | 16.45 / 16.63 | — | — | +5.29 / +5.47 | 4/5 | −27.18 / −31.94 | 25.7 / 24.2 | — | 204 / 223 | 0 |
| reserve00, 0 min, uncapped | 16.69 | 10.48 | 18.19 | +5.53 [−7.13, +17.12] | 4/5 | −37.95 | 25.9 | — | 222 | 0 |
| reserve00, + 3-hour steady-programme test | 11.37–15.24 | — | — | +0.21 to +4.08 | 2–4 of 5 | to −51.96 | — | — | — | 0 |
| fresh 2-hour ranking, 0 / 15 min | 6.86 / 8.86 | — | — | −4.30 / −2.30 | 1/2 of 5 | −34.79 / −35.12 | 19.9 / 15.1 | — | 303 | 0 |
| re-select every 6 h / 2 h | 31.12 / 3.48 | — | — | +19.97 / −7.68 | 4/3 of 5 | −13.81 / −2.53 | 15.7 / 9.5 | — | 278 / 322 | 0 |

The live re-rank's mean is high and unstable. Its nine settings span $12.45 to $27.17, with no pattern in the minutes
out (60 is best at a 5- or 15-minute re-rank and worst at 60) and bootstraps that all overlap. Its gain over no refill
is in fills ($3.11–$12.97 a day against $1.60), not in rewards. The day-by-day shows why:

| day | no refill: net / formula / held | A13: net / formula / held | reserve00 15 min: net / formula / held |
|---|---|---|---|
| 10-05 | 7.19 / 23.9 / 51 | 29.10 / 76.5 / 281 | 24.85 / 48.3 / 157 |
| 10-06 | −2.72 / 14.5 / 124 | −17.79 / 5.4 / 253 | −23.25 / 16.4 / 195 |
| 10-07 | 75.64 / 24.4 / 149 | 85.99 / 19.3 / 297 | 85.21 / 26.6 / 203 |
| 10-08 | −31.66 / 26.1 / 231 | −8.14 / 4.9 / 309 | −19.90 / 21.8 / 224 |
| 10-09 | 7.35 / 12.7 / 229 | −1.51 / 0.0 / 318 | 14.41 / 16.6 / 217 |
| 10-10 (to 12:59) | −47.58 / 25.2 / 279 | −8.66 / 0.0 / 338 | −19.67 / 25.4 / 288 |

- A13's refills earn $76.5 of formula on the first day, from an empty book.
- By that evening $281 of its $300 is held shares. From then on its buys are withheld by the cap: 3,888 to 6,857
  withheld quotes a day, against 0 to 335 with no refill on 10-05..10-09. Its formula reward falls to nothing.
- The 00:00 reserve also reaches the cap, but holds $50–$124 less at each close, and keeps quoting.
- Live-prep today already holds inventory from 10-09 and 10-10, so the later days are the closer picture of what it
  faces now.
- A refill allowed only while holdings are under $100, $150 or $200 stops refilling after the first day in every case,
  because holdings pass $150 by the first evening even with no refill. It changes nothing structural (stage
  `deployed`, `held<$…` rows).

The minutes with no slot quoting are 89 a day with no refill (109, 336, 0, 0, 0 on 10-05..10-09) and 0 with every
refill setting. The `allOut` rule never changed a result on this record: with a refill after 15 minutes, there was
always another slot quoting.

## Loss guards: what each costs and what it saves

On no refill, at $300, at-price, R 0.47, against no guard (`results/analysis.txt`, stage `guards`):

| guard | net | vs none [5–95%] | worst | on the live episodes: MrBeast wk1 / book fills / book net R 0.47 |
|---|---|---|---|---|
| none | 11.16 | — | −37.94 | −36.91 / −44.31 / 50.08 |
| **marketLoss $10** | 11.63 | +0.47 [−0.61, +1.78] | −34.56 | −8.95 / −17.66 / 73.08 |
| marketLoss $5 | −0.46 | −11.62 [−41.46, +6.57] | −22.40 | −7.21 / −15.92 / 65.25 |
| marketLoss $7.5 | 7.18 | −3.98 [−18.81, +6.68] | −22.37 | — |
| marketLoss $12.5 / $15 / $20 | 10.99 / 11.16 / 11.16 | ≈0 | −38 | $15: −16.15 / −23.54 / 65.67 |
| oneWay 4 fills / 240 min | 13.03 | +1.88 [+0.60, +3.16] | −34.43 | −31.44 / −38.92 / 50.96 |
| oneWay 3 / 240 | 14.52 | +3.37 [−1.10, +8.09] | −24.94 | −29.84 / −41.80 / 43.76 |
| midMove 60 min 15¢ | 11.15 | −0.01 | −37.94 | −16.36 / −25.07 / 64.93 |
| midMove 120 min 15¢ | 10.82 | −0.34 | −38.17 | −15.49 / −24.20 / 63.19 |
| midMove 30–120 min, 5–10¢ | 8.38–11.07 | −0.09 to −2.78 | — | −26.79 to −38.00 |
| drift 10¢ / 15¢ | 10.87 / 11.09 | −0.29 / −0.07 | −37.71 | −33.03 / −42.46 / 46.89 |
| no buy within 24 h / 48 h of the end | −4.48 / −4.25 | −15.64 / −15.40 | −37.97 / −27.85 | 0.16 / −7.24 / 79.01 (24 h) |
| side cap 3N inside 0.2–0.8 (5N in it) | 5.00 | −6.16 | −35.92 | −32.07 / −39.69 / 53.19 |
| side cap 3N everywhere | 7.01 | −4.15 | −26.17 | −51.66 / −57.24 / 32.24 |
| count markets out | −8.37 | −19.52 | −36.54 | — |

- **The live episodes** replay live-prep's own selections of 10-09 and 10-10, quoted as live-prep quoted them, from
  10-09 01:33 to 10-10 12:59 UTC.
  - This is before the reward check and the AI rule, so with the 00:00 programme and with AI markets in, and with no
    refill.
  - The three markets: MrBeast wk1 (`0x3090f7aa`, 1,479 shares bought as live), MrBeast Gaming (`0xf6f3f159`, no fills
    in the record) and Anthropic #1 AI (`0x5b3350e2`, −$10.16 under most guards; oneWay and the 3N side cap cut it to
    −$5.24 to −$6.16).
  - The $10 guard stops MrBeast wk1's buys after 1,071 shares.
  - Its reward cost on the episodes is $7.78 of formula ($200.83 → $193.05).
- **On a refill carrier** the $10 guard is free:
  - A13: $17.53 → $17.65; worst day −$19.09 → −$15.80; 10-10 −$8.66 → −$7.23.
  - 00:00 reserve, 15 minutes: $16.26 → $16.25.
  - 00:00 reserve, 0 minutes: $17.86 → $17.84; 10-10 −$29.30 → −$16.39.
- **The level matters.** On A13, $5 is −$13.36 a day and $7.5 is −$9.91. The guard costs money where it stops a market
  that later recovers. The record has more of those than of MrBeasts.
- **oneWay is left out.** It helps with no refill and with the 00:00 reserve at 0 minutes (+$0.33, worst day −$27.20 →
  −$23.32). It costs $4.12 a day on the live re-rank at 15 minutes, and $1.54–$8.42 across its settings there. Its
  episode saving is small: $5.47 on MrBeast wk1.

## Capital

- Mean capital in use (holdings at cost plus resting buys) is $199 of $300 with no refill, $248 with the 00:00 reserve
  and $294 with A13. The extra under A13 is held shares, not quotes.
- At $400, every refill setting earns less than at $300:
  - 00:00 reserve at 0 minutes: $15.19 against $17.86.
  - live60 at 15 minutes: $20.78 against $25.53.
  - Live re-rank every 15 minutes, uncapped: $19.70 against $22.46.
  - No refill: $11.50 against $11.16.
- At $500 most fall further.
- More money buys more inventory, not more reward. Add nothing.

## In sample, out of sample, uncertainty

- **In sample:** 10-05..10-07. **Out of sample:** 10-08, 10-09 and the partial 10-10.
  - No refill: $26.70 in, −$12.16 out, −$47.58 on 10-10.
  - A13: $32.43 in, −$4.82 out, −$8.66 on 10-10.
  - 00:00 reserve at 15 minutes: $28.93 in, −$2.75 out, −$19.67 on 10-10.
  - All knobs were looked at on all days, so "out of sample" here only means later.
- **Five days is a short record.** Every refill bootstrap but two crosses zero (the 6-hour re-selection's does not
  either). The two that do not are live60 at 15 minutes and live15 at 60 minutes, picked from a grid of nine, so they
  are expected by chance.
- **The formula collapse under the live re-rank is the steadier finding:**
  - It happens in all nine live settings and in no reserve00 setting.
  - Rewards are less noisy than fills.
  - It has a visible mechanism: held shares fill the cap and the cap withholds the buys.
- **The simulator's 10-10 is not live-prep's 10-10.** The simulator chose its own ten at 00:00 with AI markets out,
  and has carried its own inventory since 10-05.

## Not checked

- A13's "out while not quoting" (a tight-book skip, a pause) as a refill trigger. The simulator refills only on the
  programme.
- A13's 12,000-post governor, its tries and retries, and its first-quote budget check at refill. The simulator fills an
  empty slot from the first candidate whose programme pays.
- Whether the live reserve's candidates fill more because of how they rank (tight books with few makers) or for
  another reason. The record shows that they do, not why.
- Polymarket's own reward for the refills. R is LP-ALLOC's calibration on 10-09's ten markets.
- Sells of carried inventory beyond RW's sell quote. No guard sells.
- Per-type rules other than leaving count markets out, and any guard's interaction with the −$75 stop. No arm here
  reached it, apart from two live re-rank settings with the steady test and one $400 setting.

## Addendum 14 PROPOSAL (not applied)

Addendum 13 already holds the refill. This proposal changes one of its numbers and adds one guard. It is for Davies to
take or leave, and it would be written into `2026-10-04-polymarket-lp-prereg.md` only by the session that deploys it.

**1. The reserve is ranked once a day, at the 00:00 selection.**

    export const PM_LP_REFILL: LpRefillOptions = {
      afterMin: 15, afterMinAllOut: 0, maxPerDay: 10, perTurn: 1, triesPerTurn: 3, retryMin: 15, reserveSize: 30, refreshTop: 15, rerankEveryMin: 1440, idleAlarmMin: 30,
    };

- Only `rerankEveryMin` changes, from 5 to 1440.
- The re-rank on a new UTC day, once the selection has landed, stays. That is the 00:00 reserve modelled here.
- The per-minute programme read of the first 15 (`refreshTop`) stays: a candidate whose programme has ended is
  skipped, which is what the simulator's reserve did.
- `afterMin` stays 15, not 0. A13 counts a market out while it is not quoting, so 0 would replace a market on a single
  tight-book minute. On the record 0 and 15 differ by $1.60 a day, inside the noise.
- `maxPerDay` stays 10. Uncapped is worse in both families.

**2. A per-market loss guard on buys.**

- Rule: no BUY in a market while its fills are marked $10 or more down.
- What counts: realised P&L plus shares held at RW's adjusted mid (YES at m, NO at 1 − m), from its first fill, with
  rewards not counted.
- Sells still rest, and the guard lifts when the mark recovers.
- Proposed constant: `PM_LP_MARKET_LOSS = 10` (dollars).
- Do not set it below $10: $7.5 and $5 cost $4–$13 a day on the record.

**3. Nothing else changes:** ten markets at 00:00, $200 of first quotes, N ≤ 20, $100 a market, 5N, the −$75 stop, the
total cap at its equity (about $300 now), the reward check, the AI rule.

**Expected**, at-price, 10-05..10-09, $300:

- Net: $16.25 a day at R 0.47 (simulator units). It is $10.03 at R 0.23 and $19.11 at R 0.58; strict fills give
  $16.87.
- Against no refill: +$5.10 [−3.97, +13.24], ahead on 4 of 5 days.
- Worst day: −$27.18.
- Formula: $25.9 a day ($20.4 on 10-06..10-09).
- Mean capital: $248 of $300.
- Held at close: $199.
- Minutes with no slot quoting: 0.

**Forward test**, over live-prep's first three live days after a deploy:

- The formula reward a day.
- Holdings at the day's close.
- Buys withheld by the cap.
- The refills' fills' P&L against the markets they replaced.
- The guard's blocks, each with the market's mark a day later.

If the formula under the deployed A13 falls below about $8 a day while holdings stay above $250, which is what this
record predicts, take part 1. The guard can go in on its own.
