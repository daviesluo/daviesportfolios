# HOLDMIN: is variant-4's £1 holding line basically certain to help? (2026-10-29)

Davies, 2026-10-29: "那你研究下variant-4的结果，如果基本可以肯定效果正面的话，加入实盘live的规则里和所有测试策略包括所有variant里，并且把
variant-4删了，之后的数字都-1" (study variant-4's result; if it is basically certain to be positive, add it to LIVE's rules and to every
test strategy including every variant, delete variant-4, and number the rest down by one). This page is that verdict. Not blind:
every record was read (no no-peek rule since 2026-10-04).

**The rule** is variant-4's (`n600hold1`, PR5-OPT; `rules.holdMin {gbp: 1}`, `TWIN_RULES.holdMin`, `holdLineBase` in
`agents/quotes_live.ts`): a rung counts as held only above £1 of coin. Below it, the rung keeps carrying out its paper rung's entry,
and the coin is carried into the next trip. Over it, one exit takes the whole holding; once that exit rests, the line is the
venue's minimum again, so the exit runs to the end. The 24-hour stop counts from the fill that crossed the line. LIVE does not run
it.

**The bar, set before reading** (by the main session): positive out of sample and since 2026-09-01 on USDT-GBP with P(≤ 0) about
0.01 or less; not negative on USDC-GBP; LIVE's own days agreeing in sign; no mechanism downside.

## Verdict: yes on USDT-GBP, harmless on USDC-GBP

Every condition holds. The forward twin is under a day old and cannot add to it (§4); the case rests on the replays, LIVE's own
record and the mechanism.

## 1. What it fixes: LIVE's own record (2026-10-01 16:29:53 → 10-29 00:00)

- **USDT-GBP: 149 of LIVE's 277 entry fills were under £1** (£15.70 of entries in all, about 5.5 a day). Each made the rung held,
  withdrew the rest of its entry and sent an exit for a few pence: **205 trips under £1, 7.5 a day.** Revolut X settles in whole
  pennies (a sell of £0.0999 books £0.09; a buy of £0.1004 costs £0.11), so each lost pennies; their total is £[•] (real money,
  not written here). The £120 LIVE twin, which settles pennies as the venue does, had 132 such trips at −£0.0242 each.
- **USDC-GBP: 2 of 103 entry fills were under £1**; 2 such trips. Nearly nothing to fix.
- PR5-OPT's own count (`backtests/pr5_opt/results/dust_fills.json`): since 10-08, 142 of 232 USDT-GBP entry fills under £1,
  holding their rung 1,174 minutes in all; USDT-GBP prints £0.10 about 450 times a day since 10-08.

## 2. LIVE's own days, replayed with and without it (`backtests/compare/revx/scripts/holdmin_live.py` → `results/holdmin_live.json`)

The PR5-OPT engine unchanged, LIVE's schedule (£120 to 10-27, £600 after, both books, LIVE's fill rule, its weekend from 10-23 21:00),
twice: the venue's £0.10 line, as LIVE runs, and the £1 line. The paired difference, in bps of that day's capital a day, 28 days,
[80 %], P(≤ 0):

| book | before the haircut | after the haircut (trips £1+ × 0.825, dust trips − £0.0242) | days ahead / behind | dust trips a day | stops | mean hold |
|---|---|---|---|---|---|---|
| USDT-GBP | **+0.62** [+0.28, +0.98], P 0.002 | **+9.96** [+6.31, +13.76], P 0.000 | 17 / 0 | 5.05 → 0.04 | 2 → 2 | 82 → 116 min |
| USDC-GBP | +0.05 [0.00, +0.10], P 0.10 | +0.14 [0.00, +0.26], P 0.10 | 2 / 0 | 0.11 → 0 | 1 → 1 | 117 → 117 min |

At LIVE's £10 rungs a dust trip's pennies are 10–20 bps of the rung, which is why the haircut's figure is so large. LIVE's own
record agrees in sign: its dust trips lost money (§1), and the line removes them.

## 3. The long replays (STRATEGY-COMPARE, `reviews/2026-10-29-strategy-compare-revx.md` §0 point 5; `results/pairs.json`)

One book at a time, LIVE's rules with and without the line, after the haircut, % a year on capital, [80 %], P(≤ 0):

| book | | £600 | £1,200 | £2,400 |
|---|---|---|---|---|
| USDT-GBP | since 09-01 | **+5.25** [+3.02, +7.60], 0.000 | **+3.01** [+1.69, +4.39], 0.000 | **+1.94** [+0.90, +3.05], 0.000 |
| USDT-GBP | out of sample (05-12 →) | +1.96 [+1.13, +2.90], 0.000 | +1.12 [+0.63, +1.66], 0.000 | +0.77 [+0.39, +1.19], 0.000 |
| USDC-GBP | since 09-01 | +0.23 [+0.03, +0.44], 0.042 | +0.18 [+0.01, +0.34], 0.042 | +0.15 [+0.01, +0.29], 0.042 |
| USDC-GBP | out of sample | +0.14 [+0.07, +0.22], 0.000 | +0.09 [+0.03, +0.16], 0.000 | +0.06 [+0.02, +0.12], 0.000 |

- Of USDT-GBP's +5.25 at £600, 3.6 is the penny cost no longer paid and about 1.7 the entry that keeps resting its full size
  (+2.1 before the haircut). The same with every variant: +4.6 to +5.4 at £600 against the same rule set without it.
- PR5-OPT's own replay (`reviews/2026-10-27-pr5-rules-optimisation.md` §3.4): +0.48 bps of £600 a day under LIVE's fill rule on
  PR5's record of 09-26 → 10-27 (P(≤ 0) 0.001), +0.05 under through-only fills, and zero on the tape before the £0.10 prints began.

## 4. The forward twin: under a day, no evidence either way

`n600hold1` (variant-4) has run since 2026-10-28 22:00 UTC: about 21 hours at this reading (2026-10-29 ~19:15 UTC). Realised so
far, against `live600` (the same rules and size without the line) over the same hours: USDC-GBP £0.202 both; USDT-GBP £0.054 against
£0.218 (`live600` entered the window holding positions from 10-27; n600hold1 started flat). Its siblings weighted to USDT-GBP
(no line) took 6–8 trips under £1 each on USDT-GBP at −£0.05 to −£0.07 apiece; n600hold1 took none that cost anything. Its `_sim`
and state rows carry no error, and no `ops_errors` names it. Too short to read; it does not contradict §2–§3.

## 5. Downsides looked for

- **Stops and losses:** the 24-hour stops are unchanged on LIVE's days (2 and 1) and on every long row but one (USDT-GBP £2,400
  since 09-01: 33 → 40 a year, one more stop in 55 days). The worst day and the deepest drawdown are unchanged on every row.
- **Longer holds:** the mean hold rises (USDT-GBP 82 → 116 minutes on LIVE's days) because the short dust trips are gone, not
  because real trips last longer; the capital held in positions rises by about half a point (8.0 → 8.5 % since 09-01 at £600).
- **Coin with no exit:** a rung holding less than £1 has no exit and no stop until its entry fills again. That coin is at most £1 a
  rung (£12 over LIVE's twelve rungs; 2 % of £600), marked to market in the day's P&L, and carried into the next trip. The twin
  now carries £0.60 of it on USDT-GBP's asks. Not a risk at that size; the reading should report it.
- **exitTicksOnBook, pennyExit:** they act only on exits, which the line sends only above £1; once an exit rests, the line drops
  to the venue's minimum so the exit is trimmed and placed as before (`quotes_live.ts`, the rung loop's `exiting`).
- **The 24-hour stop** counts from the fill that crossed £1, not from a dust fill before it: no stop comes early.
- **The weekend** rule changes the fair a closure prices off; it has no bearing on the line.
- **If the £0.10 prints stop**, the line has nothing to do (PR5-OPT: zero on the tape before them): it goes neutral, not negative.

## 6. What it means

Step 2 of Davies' instruction applies: the line goes to LIVE and to every running twin, and variant-4 is retired. That is a live
rule change; the main session builds it on his word.

Files: `backtests/compare/revx/scripts/holdmin_live.py`, `results/holdmin_live.json`; the long replays are STRATEGY-COMPARE's.
Production reads (read-only SQL, 2026-10-29): LIVE's entry fills and trips by size; the PR5-OPT twins' and `live600`'s since
10-28 22:00; n600hold1's error columns and carried coin.
