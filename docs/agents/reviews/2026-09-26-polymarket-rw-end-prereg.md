# Pre-registration RW-E: RW without the markets that end on the day they are quoted

Written 2026-09-26 (UTC), before any minute it reads exists: it is judged on 2026-09-27 00:00 → 2026-10-09 00:00 UTC
of RW's paper run. Frozen by the commit that adds this file; nothing below may change after it, and any deviation is
reported as a deviation. It changes nothing that runs: RW's engine, its rule and its verdict are untouched
(`2026-09-24-polymarket-rw-paper-spec.md`), and RW-E is computed afterwards from what that engine stored.

## Why

RW's paper run, 2026-09-25 00:00 → 2026-09-26 16:16 UTC, split by how far each market's scheduled end (Gamma's
`endDate`, as the selection stored it) was from the day it was first chosen:

| Scheduled end | Markets | Fills | Rewards | Fills P&L | Total | Stress |
|---|---:|---:|---:|---:|---:|---:|
| The day it is chosen | 15 | 255 | $147.84 | −$128.53 | $19.32 | −$77.61 |
| 1–3 days | 4 | 54 | $53.58 | $21.66 | $75.24 | $36.37 |
| 3–14 days | 7 | 32 | $75.04 | −$24.14 | $50.90 | −$1.95 |
| Later | 4 | 30 | $73.88 | −$5.10 | $68.77 | $26.44 |
| All | 30 | 371 | $350.34 | −$136.11 | $214.23 | −$16.75 |

The markets that end the day they are chosen — eleven of the fifteen a city's high or low temperature, the rest a
count of posts, a video's views, a word said on a broadcast and a data release — pay the richest pools, and give back
almost all of it: by the afternoon the outcome is close to known, the prints that fill a two-sided quote come from
traders who know it, and the side that fills is the side that loses. The inventory rule stops a side at 3N, which is
where it then sits until the market settles against it. Every other group together
made a stress total of +$60.86; this one alone made −$77.61, and turned the run's stress total, one of RW's six
conditions, negative.

That split was found by looking at the run, so it is a hypothesis, not a result. This file fixes how it is tested on
the twelve days that follow, which nobody has seen.

## What was seen before the freeze (disclosed)

RW's paper run from its warm-up (2026-09-24 19:31 UTC) to 2026-09-26 16:16 UTC, on its page and in its tables; the
split above, computed from the engine's state with its own `accTotal`, `accStress` and `accCapital`; and fp5's
Polymarket search (branch `cursor/polymarket-fp5-b50c`), 58 taker rules, none of which quoted as a maker. No minute
of 2026-09-27 existed.

## The rule

RW exactly — its quotes, its reward formula, its fills from prints strictly through a quote, its 3N inventory rule,
its daily selection under $300, its settlement — except:

* On each UTC day `D`, a market in `D`'s selection whose scheduled end (`pm_rw_selection.end_date`) is before
  `D` + 24 h is **not quoted on `D`**. On that day it is a market that left the selection: inventory it already holds
  from an earlier day is held, marked each minute at the adjusted midpoint, and settled at its payout, as RW does.
* A market with no scheduled end is quoted as RW quotes it.
* The capital of a market not quoted on `D` is not given to any other market: RW-E is RW's portfolio less those
  market-days, not a different selection (the books of the markets RW passed over were never recorded).

## Data and replay

Only what RW's engine stored: `pm_rw_selection` (the day's portfolio and each market's `end_date`), `pm_rw_minutes`
(each minute's book as read: `quoting`, `tick`, `bb`, `ba`, `ab`, `aa`, `q1`, `q2`), `pm_rw_prints` and
`pm_rw_settlements` (`settled_at`, `payout`). The replay drives `agents/pmrw.ts`'s own `stepRw`, `snapshot`,
`accTotal`, `accStress` and `accCapital` minute by minute, in the engine's order, settling a market where the engine
did (its `settled_at`: after the minutes decided in that run, before the next). It runs from the run's start,
2026-09-25 00:00, and removes nothing before 2026-09-27 00:00, so RW-E enters the twelve days holding exactly what RW
held; its result is the change over the twelve days, with what it carried in marked where RW marked it at
2026-09-27 00:00.

**Check before anything is read:** the same replay with no market removed must reproduce RW's own `pm_rw_days` rows
for every day it replays, 2026-09-25 → 2026-10-08 — the running total, stress total, rewards and fills at each day's
close — to within $0.01. If it does not, the replay is wrong, nothing below is computed, and the result is reported as
void with the difference.

## The bar (all of, over 2026-09-27 → 2026-10-08, twelve days)

1. Total > 0.
2. Stress total > 0.
3. At least 100 fills.
4. No single market holds more than 50 % of the total, and the total without the best market is > 0.
5. The twelve day totals resampled with replacement (2,000 draws, seed 20261009, Python's `random.Random(seed)`,
   twelve `choice`s a draw, the sums sorted and the one at index `int(0.05 × 2000)` read): the 5th percentile of the
   sum is > 0.
6. Worth money: the total on RW-E's capital (RW's definition: the largest, over the twelve days, of the sum of the
   capital of the markets quoting or holding that day), annualised (× 365 / 12), exceeds 4 % a year.
7. The mechanism holds: RW-E's stress total exceeds RW's own stress total over the same twelve days.

Descriptive, not part of the bar: the removed market-days' own rewards, fills P&L and stress, by category; RW-E
against RW by day; how much capital RW-E left idle.

## What it cannot show

What the idle capital would have earned in the markets RW passed over; whether the markets that end within a day
were worse because of their end or because of their kind (eleven of the fifteen are temperatures); and, as for RW,
whether Polymarket pays what its formula implies, and whether this account may quote.

A rule that keeps quoting these markets but stops once the outcome is near-certain (a temperature bucket once the
station's running high or low has passed it, say) goes after the same cause more narrowly. It is not this test: it
needs a pre-registration of its own, frozen before anyone reads the twelve days' fills market by market.

## What follows

Reported beside RW's own verdict on 2026-10-09. If RW-E passes, it is the rule any live design under the Polymarket
item uses in RW's place (on Davies' word, `eu-west-1` only, his Ireland attestation current). If it fails, the split
above was noise, and it is reported as such.
