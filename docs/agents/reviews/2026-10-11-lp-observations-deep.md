# LP-OBS-DEEP: the pause and held stock, the basis of R, and rebates in the stop

Research only (2026-10-11, read 01:19–01:30 UTC). No live path, config or migration changed. Every database read was a
read-only `select`; no order was placed or cancelled. SQL, data, the script and its outputs are in
`docs/agents/backtests/lpobsdeep/` (`MANIFEST.json`). Code read at `a31ea31c` (`pm_lp.ts` and `pm_live.ts` at
Addendum 17's bytes, `pm_lp_live_view.ts`, `agents/index.ts`), and the pre-registration's own `pm_live.ts` at `8a36faef`
(sha256 `23112a4f…`). Not blind. Nothing here is applied: Davies decides.

Davies, 2026-10-11, verbatim:

> 这几项深度研究下并推荐我该怎么操作

In English: study these items in depth and recommend what I should do. The items are LP-RULES' observations 1, 3 and 4
(`reviews/2026-10-11-lp-rules-audit.md`), numbered 3, 4 and 5 in his list. The cap buffer and the refill budget
(observation 2) are another study's.

## Verdicts

| item | recommendation | effect | verdict |
|---|---|---|---|
| 3. the pause and held stock | close-only markets rest their exit through a pause; selected markets stay as frozen | +$0.0 to +$0.2 a day (−$0.9 a day in a MrBeast-like tail) | **change, as an addendum Davies approves, with the next `pm_live.ts` change** (not worth a deploy of its own) |
| 4a. the 7-day end rule's R | read 10-09 at its like-for-like formula, as `lpLiveR` does | today it reads **0.154**, under the 0.20 bar; at day 7 it can stop live-prep for good on a true R of 0.26–0.37 | **fix now (a defect), by an addendum before the 7-day read on 10-16** |
| 4b. TESTING rows at the live R | price paper rows at R on the whole formula | they read 1.1 % high now (+$0.52 a day on "Reward quotes"), 4.6 % once the prior has faded (about +$2.6 a day) | **fix now (a defect; display only)** |
| 4c. one definition of R | paid ÷ formula over every live quoted minute, 10-09 like for like: **0.737**; the scored 0.763 shown beside it | — | **change the page's label and basis with 4b** |
| 5. rebates in the stop | count rebates (and fees) so the stop trips when the page's TOTAL reaches −$75 | trips later by the rebates booked: $6.79 now, about $3.4 a live day | **fix the book, by an addendum** (the stop is pre-registered); not urgent, the room is $71 |

## Item 3: the pause also empties the exit sell of held stock

### What the code does, and what was meant

- `pm_live.ts` judges the pause on every market a turn reads, carried ones included. A paused market's intents are all
  withheld (gate `pause`), the sells of `closeOnly` and of Addendum 16's exit with them: "Paused (live-prep): nothing
  rests in the market this minute; what is held is held."
- The pre-registration's own code (`8a36faef`) did exactly this. So it is not a departure from the frozen rule.
- Three things point the other way, for markets worked close-only:
  - **The text.** The pause is written under "Quotes, every minute, in each selected market". The carried paragraph says
    a carried market rests its sells "until flat or selected again", with no pause. Check c6 lists "a carried, paused
    or close-only minute" as one that "places sells only", which presumes a paused minute may place a sell.
  - **The evidence.** Phase A's S2, the arm the specification is, works carried stock off with `exitPassiveModel`
    (`backtests/pmlp/scripts/sim.ts`, lines 271–282). That loop runs before the pause and ignores it. So the pause's
    evidence (positive in 20 of 20 plateau cells at R 0.40) never paused a carried exit. It paused selected markets
    whole, their sells of held stock included.
  - **The rationale.** Phase A: "its gain here comes through the cap: fills avoided after a jump keep capital free". A
    filled sell frees capital. And x2's pause (RW-X, 2026-09-27) was a quoting rule on a paper book that never sold
    what it held.
- **What a jump means for an exit.** A jump is news. A sell resting into news is filled when the price moves through
  it, which is adverse if the move continues. It is also the way out of a market the path no longer wants. The record
  below decides which matters here.

### The record (`results/pause_exits.txt`)

- **581 paused market-minutes held stock, in 9 episodes.** In 400 of them the rule would have rested an exit:
  - carried: 60 minutes;
  - out: 41 minutes, the LP-RULES' 41;
  - selected, held ≥ N: 299 minutes.
  The other 181 held dust or a lot under the 5-share minimum, which no order can sell. LP-RULES' 401 is these 400 and
  one minute with no adjusted mid.
- **No through-fill.** In none of the 400 minutes did the next minute's book reach the exit's price.
- **Fill rate.** On the live record a live SELL fills 0.0838 shares per resting order-minute (1,578.22 shares over
  18,822 order-minutes).
  - The trade-through proxy catches 16 % of live fills: 28 of 175 fill-minutes. The rest are takers at our price with
    the book unmoved (`sql/fill_calibration.sql`).
  - So the realistic fill model is the live rate, not the proxy.
- **Exit price against later value.** At the pause's end the exit's price was above the token's value by:
  - +5.9 ¢ a share on average, minute-weighted;
  - +10.4 ¢ six hours on;
  - +13.2 ¢ at the latest mark.
  By episode it is mixed: 3 of the 6 exit-able episodes favour the exit, and 3 do not (−9.5, −7.0, −2.5 ¢).
- **Adverse selection.** Live sells that did fill were followed by the price rising against them:
  - −1.7 ¢ at 60 minutes and −3.6 ¢ at six hours without MrBeast wk1;
  - −54 ¢ at six hours on MrBeast wk1, which resolved YES.

### Each option, $ a day

The expected exit shares are the exit-able minutes × 0.0838, over 2.0 days. Each per-share value runs from −1.7 ¢ (live
sells' 60-minute markout) to the episodes' own edge at the pause's end.

| option | exit-able minutes | shares a day | $ a day | 6-hour tail (−21.6 ¢) |
|---|---:|---:|---:|---:|
| keep (today) | 0 | 0 | 0 | 0 |
| exits rest in every paused market | 400 | 16.8 | −0.29 to +0.99 | −3.62 |
| exits rest in close-only markets only | 101 | 4.2 | −0.07 to +0.19 | −0.91 |
| exits rest at a wider price (+1 tick or more) | — | under 16.8 | ≈ 0: no through-fill even at the rule's price | — |

The close-only option also frees about $2 a day of buy budget while the cap binds.

### Recommendation

- **In a market worked close-only, the pause withholds nothing.** That is a market carried, out (the reward check, the
  backstop, the AI rule, the loss guard, a refill's replaced market) or quoting while opening is stopped. Its exit
  (`lpExitQuotes` through `closeOnly`) rests as in an unpaused minute.
- **A selected market still quoting keeps the frozen pause:** 15 ¢, 60 minutes, buys and sells alike.
- **Pin:** a paused carried market with 20 YES rests its SELL of 20, and a paused selected market rests nothing.
- **Why, though the money is noise:**
  - it is what the text and the evidence describe;
  - it is Addendum 16's own principle, that no holding is left with no way out;
  - after the total stop trips, every market is close-only, and the pause then holds the unwind for an hour after
    each jump.
- **Verdict: change, as an addendum Davies approves, bundled with the next `pm_live.ts` change.** A `pm_live.ts`
  change also needs mid-pool's pre-registration noted. **Keep** for selected markets.

## Item 4: which R, where

### The figures (`scripts/r_bases.ts` → `results/r_bases.txt`, through the page's own functions)

| basis | formula | R |
|---|---:|---:|
| scored, 10-09 like for like (`lpLiveSummary.r`: the page's R (ACTUAL), DAYS) | 37.2260 | **0.7633** |
| whole, 10-09 like for like (LP-RULES' figure) | 38.5752 | **0.7366** |
| whole, as the readout wrote it (`lp_readout.sql`: the end rule and the 14-day readout) | 184.3913 | **0.1541** |
| `lpLiveR`'s point (prior 0.2–1, two days' weight), scored, deployed | — | 0.5901 [0.333, 1.044] |
| `lpLiveR`'s point, whole | — | 0.5835 [0.329, 1.036] |

By day: 10-09 0.807 like for like (0.042 whole as written), and 10-10 0.751 scored or 0.718 whole.

LP-RULES' 0.737 is itself slightly mixed. Its 10-09 figure is the scored like-for-like one, since `rtrue.py` priced only
scored minutes. Scaled by Addendum 9's whole/scored ratio on 10-09 (7.56 / 7.15), a pure whole basis reads about
**0.728**.

### What each place does

- **The page's R (ACTUAL) and DAYS:** paid ÷ scored formula, both on scored minutes. Consistent, and as Addendum 9 chose.
  Labelled only "R (ACTUAL)".
- **Today's estimate** (`lpRewardEstimate`): R from `lpLiveR` on scored days, times today's scored hours
  (`pm_lp_live_hours.formula_scored_usd`). The rate of earlier days is the scored formula too. Consistent. The
  readout's and the view's "scored" are the same test: both sides `scoring` true.
- **QUOTES' Rewards (est.):** unread scored formula × the market's point R. Consistent.
- **TESTING's paper rows** (`agents/index.ts`, `priced`): first `atProgramme`, each row's formula rescaled to the
  listing's rate (`pm_prog_factors.formula_true`), then `atLiveR` at `lpLiveR`'s scored point. A paper formula counts
  every quoted minute and has no scoring flag: it is whole-basis. **Scored R on a whole formula: mixed (defect 2).**
- **The end rule and the 14-day readout** (`lp_readout.sql`, frozen): R = Σ paid ÷ Σ `formula_usd`. That counts 10-09
  at the $153.90 the stale programme gave, which Addendum 10 corrected for `lpLiveR` only. **Defect 1.**

### Defect 1: the 7-day end rule reads a stale 10-09

- **The rule.** After 7 live days with ≥ 40 market-days, R < 0.20 stops live-prep for good, read by `lp_readout.sql`.
- **The reading.** Today the script reads 0.154.
- **When it trips.** With days 3–7 at a daily formula F and a true R, it trips at day 7 when R is under:
  - 0.369 at F = $10;
  - 0.313 at $15;
  - 0.285 at $20;
  - 0.256 at $30.
- **The same days like for like** read 0.35–0.55 there. For example, F = $15 and R = 0.30 reads 0.196 (trip) against
  0.448.
- **Live-prep's own R is 0.74, so it does not trip today.** But the guard misfires exactly in a degraded but paying
  regime. The 14-day readout to Davies would also misstate R: about 0.5 at R 0.74 and $30 a day.
- **What to do.** An addendum before the day-7 read (10-09 → 10-15; read on or after 10-16 01:00 UTC): the end rule
  and the readout take 10-09 at its like-for-like formula, $8.081876 (`LP_R_DAY_CORRECTIONS`), and every other day as
  written, on the whole formula. Each row reports the scored R beside it. The frozen script stays as it is: the
  addendum names a corrected copy, as Addendum 10 did for `lpLiveR`.

### Defect 2: TESTING rows priced on mixed bases

- **The overstatement.** (point_scored − point_whole) × the paper formula, display only:
  - 1.1 % now: +$0.52 a day on "Reward quotes" (RW-C, $78.99 of programme formula on 10-10), and +$1.22 over its
    10-09 → 10-11 rows;
  - +$0.08 a day on mid-pool;
  - the same share on variant-1 and the RW-X arms.
- **As the prior fades** it tends to 10-10's scored/whole ratio, 4.6 %: about +$2.6 a day on that row at R 0.72.
- **The fix.** Price paper rows at `lpLiveR` on the whole formula (`formula_usd`, 10-09 like for like).

### Recommendation: one definition

- **R = Σ rewards paid (native + sponsored) ÷ Σ formula over every live quoted minute, 10-09 at its like-for-like
  figure. Rebates are never in R.**
- **Why the whole formula:**
  - it is the pre-registration's R ("paid ÷ formula");
  - the end rule's bar and every study are on it;
  - a paper row can only be priced on it.
- **Where it goes:**
  - **Headline:** label "R (paid ÷ formula)", 0.737. Beside it, "0.763 on the minutes Polymarket confirmed scoring".
  - **TESTING rows:** at `lpLiveR` on the same whole basis (defect 2).
  - **Today's estimate:** may stay scored × scored, which is consistent. For one definition, move it to whole × whole
    (`pm_lp_live_hours.formula_usd` is already there). The difference is 4.6 % of the band.
  - **End rule and readout:** as above (defect 1).
- **A note, not a defect.** Estimates and TESTING use `lpLiveR`'s shrunk point, 0.590. The pooled record says 0.737.
  The prior (median 0.447) still weighs two days against two, by design (Addendum 9); it is half its weight now and a
  fifth after eight days. The estimate tile is priced on that band (0.33–1.04), not on the headline R. A label such as "R used
  for estimates (prior-weighted)" would stop the two being read as one.

## Item 5: maker rebates and the −$75 stop

### What the stop counts (`pm_live.ts`, the turn's stop block)

- **The basis** is `bookPnl(tb, marks).total + paid`:
  - CONFIRMED live fills and settlements (`settlementFills`), realised plus held marked at the mid of the book the turn
    read; a token with no mark is held at cost;
  - plus Σ (`actual_usd` + `actual_sponsored_usd`) of `pm_lp_reward_days`' live rows.
- **Not counted:** maker rebates (`rebate_usd`, in the same rows) and fees (all fills are maker, so $0 so far).
- **Same as frozen.** The pre-registration's own code read the same two columns. The text ("what Polymarket paid as
  the readout booked it") is ambiguous, since the readout books rebates too.

### What the page counts

- **TOTAL** = fills + rewards + rebates − fees (`lpLiveSummary.totalUsd`).
- **FUNDED** subtracts rewards and rebates from the pUSD residual (`lpFunding`). So TOTAL is exactly equity less the
  money put in.
- **The stop's basis** is TOTAL − rebates + fees.
- **The page never shows it.** The payload carries `stop.basisUsd` and `roomUsd`, but the page renders only
  `trippedAt`. Davies reads one number and the stop judges another: at 01:00 UTC marks, +$3.16 against −$3.63. **Two numbers for one
  thing.** The direction is the safe one: the stop trips $6.79 early.

### Should rebates count?

- **The stop is a cap on the loss of the deposit**, and the deposit's loss is equity − FUNDED. Rebates are pUSD in the
  account, in equity, in FUNDED's arithmetic and in the cap (`lpCapital` reads pUSD). Leaving them out caps the loss
  at $75 − rebates, not at $75.
- **They are as reliable as rewards.** The same readout reads them (`/rebates/current` per day, for the maker
  address). They land about an hour after the rewards (on 10-10 between 00:27 and 01:17 UTC). They are written on the
  first payout read, read again every ten minutes, and counted on the first read after 03:00. So the lag is at most a
  day plus about an hour, the same as the rewards'.
- **They are not small.** $6.79 in two days is 0.176 of the formula and 0.239 of the rewards. They also arrive where
  the fills are heaviest: MrBeast wk1 paid $2.71 of 10-10's $4.82.

### The effect (`results/stop_path.txt`)

- **The live path's worst hour,** 10-10 11:00 UTC, was basis −$37.98: room $37.02, or $39.00 with the $1.98 of
  rebates booked by then.
- **Now** it is −$3.63 (room $71.37), or +$3.16 (room $78.16) once 10-10's $4.82 is booked.
- **No historical path trips −$75 either way:**
  - LP-ALLOC's deepest fall on today's rule at $330 was −$60.83, and on its no-AI rule −$37.70;
  - LP-REFILL's worst day was −$37.94.
- **On a path that does trip,** counting rebates moves the trip later by the rebates booked before it: about $3.4 per
  live day so far, each booked about 01:00–01:20 UTC the next day.

### Recommendation

- **The basis becomes** fills + rewards + rebates − fees, so the stop trips when the page's TOTAL reaches −$75. That
  is equity at FUNDED − $75, the deposit loss Davies set.
- **Show the stop's room** on the page under TOTAL: `roomUsd` exists, and the page omits it.
- **Pin:** a turn with rewards $10 and rebates $5 trips at fills −$90 and not at −$85.
- **The alternative,** if Davies prefers the margin: keep the basis and show it as "stop basis (no rebates)" beside
  TOTAL. Either way the page shows the number the stop judges.
- **Verdict: fix the book, by an addendum Davies approves** (the stop is pre-registered). It is not urgent: the room
  is $71, and the error is on the safe side.

## Defects

1. **`lp_readout.sql` (the end rule, the 14-day readout) reads 10-09 at its stale $153.90 formula.** R reads 0.154 today.
   Fix by addendum before 10-16 01:00 UTC.
2. **TESTING's paper rows are priced at R on the scored formula, applied to a whole-basis formula:** +1.1 % now, →
   +4.6 %. Fix in `agents/index.ts` / `pm_lp_live_view.ts` (display only).
3. **The stop and the page's TOTAL differ by the maker rebates** (and fees), and the page does not show the stop's basis.
   Fix by addendum (count them) or, at least, show the stop's basis and room.

No defect in the pause: the frozen code pauses carried exits, and item 3 is a rule change.

## Noticed, not asked

The end rule's bar of 0.20 came from the studies' break-evens in their own units. On the live record the break-even R
is about 0.71 with rebates and 0.89 without: fills −$34.28 marked, over 38.58 of whole formula (LP-RULES' figures). At
the live R of 0.737, live-prep is near break-even, and the −$75 stop, not the 0.20 bar, is the guard that binds. That
question is the 14-day readout's (10-23), and Davies' to set.

## Not checked

- No prints were read. pm-rec's frames are in Storage as gzip, and the paper layer's prints end at the go. Fills in
  paused minutes are modelled: the live sell rate, with the next-minute book as the adverse case.
- Whether takers are more active right after a jump than on average: there are no live fills in such minutes to
  measure it.
- The deepest fall of each study with rebates in it: no study modelled them. The shift is stated as the rebates booked.
- The other agent's items, the cap buffer and the refill budget.
