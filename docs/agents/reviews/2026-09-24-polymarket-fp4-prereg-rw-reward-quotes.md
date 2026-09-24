# Pre-registration RW: small two-sided quotes for Polymarket's liquidity rewards, forward (fp4, test RW)

Written 2026-09-24 (UTC) before the data this test reads exists: it runs FORWARD, on order books
recorded once a minute from the first round after this file's commit, and on the prints of those
minutes. Frozen by the commit that adds this file; its sha256 is recorded in the study. Nothing below
may change after the freeze; any deviation is reported as a deviation.

## Why this is Polymarket's own

Polymarket pays makers to rest orders near the midpoint: each rewarded market has a daily pool, a
minimum qualifying size (shares) and a maximum qualifying spread `v` (cents); once a minute the book is
sampled and every maker scores `S(v, s) = ((v − s)/v)²` × size for each qualifying order `s` cents from
the size-cutoff-adjusted midpoint, two-sided depth scoring more than one-sided (single-sided counts at
a third, and not at all when the midpoint is outside [0.10, 0.90]); the day's pool is split by each
maker's share of the summed scores. M1 (2026-09-24 02:17 UTC) found 16,075 rewarded markets and
$147,864 a day of pools, a median pool of $3 a day, and books where the qualifying depth inside `v` is
thin on many of them; the public `market_competitiveness` field of `/rewards/markets/multi` matched
the book-computed score divided by 1,000 on the two markets checked. M4 found large reward income
among the makers active on the richest markets, and trading losses that eat much of it. The claim
tested: a small account quoting the minimum qualifying size on both sides of the rewarded markets
where its share of the pool is largest earns more in rewards than it loses to the orders that fill
it, forward, after every cost.

## What was seen before the freeze (disclosed)

M1 (counts, pools, one book snapshot of every rewarded market, a naive reward-share estimate that
put a $100 account at hundreds of dollars a day — the reason for this test, and the number it is most
likely to overstate), M4 (all-time P&L splits of 400 maker wallets: $6.78 M of reward income against
$16.5 M of trade P&L among them; small wallets mostly lost), the documentation of the programme, and
two live books compared with `market_competitiveness`. No minute of the test window existed.

## Data (keyless, public, forward)

* At the start: `/rewards/markets/current` (native and sponsored) and Gamma's market records for every
  market with a total daily rate of at least $10 that is accepting orders (`rw_collect.py`). This
  universe is frozen then.
* Every minute until the end: the YES book of every universe market (`POST /books`), kept as the levels
  within 10 ¢ of the touch. The NO book is the YES book's mirror (M1: 400 of 400 checked).
* After the end: each universe market's taker prints over the window (`/v2/trades?condition=`).

## Window

From the first book round written after this file's commit (`T0`, recorded) to `T0 + 8 h`. Minutes
the collector missed quote nothing.

## Rule (per market, per minute `t`, from the book read at `t`; orders live over `(t, t + 60 s]`)

* Adjusted midpoint `m`: the midpoint of the best bid level and the best ask level whose size is at
  least the market's minimum qualifying size. Either missing → no quote this minute.
* Our bid `b` = the lower of (best bid + one tick) and (`m` − half a tick), rounded down to the tick;
  our ask `a` = the higher of (best ask − one tick) and (`m` + half a tick), rounded up. Never through
  the other side. Size `N` = the minimum qualifying size (at least 5 shares) on each side.
* Our score: `Q = min(S(v, s_b) × N, S(v, s_a) × N)`, `s_b = 100(m − b)`, `s_a = 100(a − m)`
  (0 where `s ≥ v`). Others' score from the book (levels of at least the minimum size, within `v` of
  `m`, as if each such level were one qualifying order): `Q1` (bids), `Q2` (asks); others =
  `max(min(Q1, Q2), (Q1 + Q2)/3)` when `0.10 ≤ m ≤ 0.90`, else `min(Q1, Q2)`.
* Reward for minute `t` = `rate / 1440 × Q / (Q + others)`: the day's pool spread evenly over its
  samples (the conservative reading; the documentation's final normalisation could pay more).
* Fills (never a touch): a print in `(t, t + 60 s]` whose YES-equivalent price is strictly below `b`
  and that sells YES (a taker SELL of YES, or a taker BUY of NO at `1 − p`) fills our bid at `b` for
  `min(remaining N, print size)`; strictly above `a` and buying YES (a BUY of YES, or a SELL of NO)
  fills our ask at `a`. Makers pay no fee.
* Inventory: net YES position; the bid is not quoted while net YES ≥ 3N, the ask not while
  net YES ≤ −3N. No other risk rule: quotes follow the book every minute.
* Mark at the window's end: the last adjusted midpoint seen (the settlement payout if the market
  resolved inside the window).
* Capital of a market: `N × (b + 1 − a)` at its first quote, plus the cost of its largest inventory.

## Portfolio

* **Primary**: at `T0`, every universe market's first-round expected reward per dollar of capital,
  `rate/1440 × Q/(Q + others) / (N × (b + 1 − a))`; take markets in that order until $300 of capital
  (whole markets only). Frozen at `T0`.
* Secondary, descriptive: every universe market, alone, and by fee category.

## Arms

1. Primary, as written.
2. Stress (must stay > 0): rewards halved; fills priced one tick worse (bid fills one tick higher, ask
   fills one tick lower).
3. Descriptive: the reward and fill components apart; fills and markouts at 5 and 60 minutes; the
   same rule with `N` = 2× the minimum size.

## Chance comparison

The primary's markets are resampled with replacement (2,000 draws, `random.Random(20260924)`); the 5th
percentile of the resampled total must be above zero. The result must not rest on a few markets.

## The bar (primary, over the window, all of)

1. Total P&L (rewards + fills marked) > 0.
2. Stress total > 0.
3. At least 30 fills (fewer cannot measure the adverse selection the rewards pay for).
4. No single market holds more than 50 % of the total, and the total without the best market > 0.
5. The resampled 5th percentile > 0.
6. Worth money: the total over the window, annualised, on the primary's capital, exceeds 4 % a year.

## Determinism

`rw_test.py` run twice from the recorded books and prints; byte-identical JSON, sha256 recorded.

## What this cannot show

Whether Polymarket pays what its published formula implies (only a live account's rewards say that);
the queue at our price (strictly-through fills are conservative when we join a level, and miss prints
AT a price we improved); how other makers react to our orders; the tails of eight hours; and whether
the UK account may trade at all (Polymarket lists the United Kingdom as close-only: reported in the
study, outside this test).
