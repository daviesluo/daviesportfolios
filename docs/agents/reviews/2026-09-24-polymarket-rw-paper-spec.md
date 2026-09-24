# Paper test of RW: minimum-size two-sided quotes for Polymarket's liquidity rewards, fourteen days (spec)

Written 2026-09-24 (UTC) before the first paper minute exists. Frozen by the commit that adds this file; nothing
below may change after it, and any deviation is reported as a deviation.

## Why

RW (`2026-09-24-polymarket-fp4-prereg-rw-reward-quotes.md`) passed all six of its pre-registered conditions forward,
on 268 recorded minutes of one day: +$46.61 on $480, rewards $50.92 against fills −$4.31 (study §5, reference
§3.33). One day's minutes cannot say whether it holds across days, across a portfolio that changes as markets end, or
with inventory carried from one day to the next. Davies: run it on paper (2026-09-24). This is that run.

It is paper. Nothing is placed, no key is read, no signed or order endpoint is called: every input is a keyless
public read of Polymarket, and every reward and fill is computed from the published formula and the public prints.
What only an account that quotes can show — whether Polymarket pays what the formula implies — stays outside it.

## The rule

Exactly RW's rule, per market and per minute `t` (the pre-registration's text governs):

* The adjusted midpoint `m` from the best bid and ask levels holding at least the minimum qualifying size; our bid
  a tick above the best bid but no higher than `m` − half a tick, our ask a tick below the best ask but no lower than
  `m` + half a tick, never through the other side; `N` = the minimum qualifying size, at least 5 shares, each side.
* Our score `Q = min(S(v, s_b) × N, S(v, s_a) × N)`; the others' score from the book's levels of at least the
  minimum size within `v` of `m` (two-sided, a third one-sided, and only the smaller side outside [0.10, 0.90]);
  the minute's reward `rate / 1440 × Q / (Q + others)`.
* Fills only from prints strictly through a quote, in `(t, t + 60 s]`, on the side that takes it (a NO print read at
  `1 − p`), up to `N`; makers pay nothing.
* A side is not quoted while its inventory is at `3N` in that direction; no other risk rule.
* The book is the one read at `t` (levels within 10 ¢ of the touch, as RW recorded them). A minute whose book was not
  read quotes nothing.

One thing the forward test froze that cannot be frozen for fourteen days: **the tick** is the book's own `tick_size`
at `t` (Polymarket changes a market's tick as its price nears 0 or 1).

## The portfolio, re-selected daily

Each UTC day, in its first minutes, and once when the engine starts, the universe is every market in
`/rewards/markets/current` (native and sponsored) with a total daily rate of at least $10 and a maximum spread above
zero that Gamma shows accepting orders with two tokens. Each is ranked by RW's first-round expected reward per dollar
of capital, `rate / 1440 × Q / (Q + others) / (N × (b + 1 − a))`, from one book read at the selection; whole markets
are taken in that order while they fit in $300 of capital, and one that does not fit is passed over (RW's selection).
A market's rate for the day is its rate at the selection.

A day is quoted only on its own selection, from the minute it lands; the selection is tried every five minutes until
it does, and the minutes before it quote nothing.

A market that leaves the selection stops quoting. Its inventory stays, is marked each minute at the adjusted
midpoint, and is settled at the payout once Gamma shows the market closed with one and a closed time (rw_test.py's
condition). A market that closes while selected is settled the same way.

## Timing

Books are read once a minute for every quoting market and every market holding inventory. A minute is decided at
least two minutes after it starts, when its prints are public: the public feed showed 4,779 new prints over four
minutes of 2026-09-24 a median 4.3 s and at most 9.7 s after their own timestamp. The feed answers
`cache-control: public, max-age=300`, and its CDN serves a repeated URL from its copy, so every print read carries a
parameter no earlier read carried; without it, a minute could be decided on a copy made before its prints existed.
Minutes the engine missed quote nothing; a decided minute is never decided again.

## Days and totals

* **The run:** fourteen full UTC days, 2026-09-25 00:00 → 2026-10-09 00:00 UTC. Minutes before 09-25 00:00 are a
  warm-up, reported apart and counted nowhere below: its day is closed with its inventory at its marks, and the run
  starts with no inventory, no rewards and no capital. After 2026-10-09 00:00 nothing is read, decided or selected.
* **Total:** rewards, plus the cash of every fill, plus inventory × its mark (the adjusted midpoint, or the payout
  once settled). A **day's total** is the change of the total over that UTC day.
* **Capital:** per market, `N × (b + 1 − a)` at its first quote plus the cost of its largest inventory (RW); the
  run's capital is the largest, over the fourteen days, of the sum of the capital of the markets quoting or holding
  that day.
* **Stress:** rewards halved, every fill one tick worse, inventory marked at the adjusted touch (a long at the
  adjusted best bid, a short at the adjusted best ask).

## The bar (all of, over the fourteen days)

1. Total > 0.
2. Stress total > 0.
3. At least 100 fills.
4. No single market holds more than 50 % of the total, and the total without the best market is > 0.
5. The fourteen day totals resampled with replacement (2,000 draws, seed 20261009, drawn as rw_test.py draws them:
   Python's `random.Random(seed)`, fourteen `choice`s a draw, the sums sorted and the one at index `int(0.05 × 2000)`
   read): the 5th percentile of the sum is > 0.
6. Worth money: the total on the run's capital, annualised (× 365 / 14), exceeds 4 % a year.

Descriptive, not part of the bar: positive days, rewards against fills, markouts, results by category, settlements,
the inventory left at the end.

## What it cannot show

Whether Polymarket pays what its published formula implies; the queue at our price; how other makers react to a new
quote; and whether this account may quote (the review's §0).

## What follows

If it passes, the next step is a live test of the same rule under the plan for this account
(`docs/LEDGER.md`, the Polymarket item) — the only way to see what Polymarket actually pays. If it fails, RW stops.
