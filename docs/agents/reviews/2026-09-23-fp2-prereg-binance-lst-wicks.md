# Pre-registration — T3: resting bids under Binance's liquid-staking tokens, sold back at their ratio

Written 2026-09-23 before any return of this rule was computed. Binance spot, UK retail, spot only.

## Mechanism

WBETH (Binance's wrapped staked ETH) and BNSOL (Binance's staked SOL) are redeemable claims on ETH and
SOL at an exchange rate that only grows; their USDT books are 20–200 × thinner than ETH's and SOL's. A
seller who dumps the token into its own thin book pushes it under the ratio its underlying implies;
arbitrageurs bring it back. A bid resting under the ratio is paid for that immediacy. This is the first
program's PR2 mechanism (pegged-asset wicks) on a book class it did not test.

## What was already seen (disclosed)

`results/m9_lst_wicks.json` and `results/m9_lst_wicks_baselow.json` (2024-10-01 → 2026-09-22, both
tokens): counts of minutes whose LST low sat 0.5 / 1 / 2 / 5 % under the trailing ratio, the $ in those
minutes, and the median distance from fair 60 minutes later (against the base's low: WBETH 106 / 10.6 /
4.5 / 1.5 events a year, BNSOL 230 / 27 / 5.7 / 1.6; 60 minutes later −0.5 / −108 / −154 / −555 bps and
−1.8 / −3.0 / −132 / −443 bps). **That window has therefore been seen in aggregate and is not the
decisive one.** No P&L of any rule has been computed. Nothing of WBETH before 2024-10-01 has been read.

## Data

Binance spot 1-minute klines (data.binance.vision archive; trade-built, so a low or high is a trade):
WBETHUSDT, ETHUSDT, BNSOLUSDT, SOLUSDT. sha256 of every input goes into the output.

## Windows

* **Primary OOS (untouched): WBETH 2023-06-01 → 2024-09-30.**
* Confirmation window (seen in aggregate, descriptive, not decisive): WBETH and BNSOL 2024-10-01 → 2026-09-22.
No parameter is chosen from data; the rule is fixed below.

## Rule (the loop acts at the start of each minute; an order placed at minute m can fill from minute m+1)

* `ratio(m)` = median of close(LST)/close(BASE) over minutes [m−1440, m−1] (at least 720 present, else no
  quotes). `fair(m) = ratio(m) · close(BASE, m−1)`.
* Three rungs, k ∈ {0.5 %, 1 %, 2 %}, $100 each, independent: a flat rung rests a bid at `fair(m)·(1−k)`,
  re-priced whenever its target moves more than 5 bps. It fills in minute j if `low(LST, j) < bid`
  (strictly), at the bid, paying 10 bps (maker).
* A filled rung rests an ask at `fair(m)` (re-priced the same way); it fills in minute j if
  `high(LST, j) > ask` (strictly), at the ask, paying 10 bps. After 24 hours unfilled, the rung sells at
  `close(LST, j)` less 10 bps and less half the LST's median spread (2 bps WBETH, 4 bps BNSOL). A rung is
  re-armed at the next minute after its exit.
* Capacity arm: fill quantity capped at 10 % of the LST's quote volume in the fill minute.

## Arms

1. Primary, as written.  2. Stress (must stay > 0): 20 bps a side; entries and exits need the low/high
   beyond the price by one more 1-bp step.  3. Descriptive: per rung; per month; the capacity arm;
   the confirmation window.

## Null

Random-time twins: each OOS round trip of the primary is replaced by an entry at the LST close of a
uniformly drawn OOS minute (same rung size), followed by the same exit rule; 2,000 draws,
`random.Random(20260923)`.

## The bar (primary OOS; all must hold)

1. P&L > 0.  2. P&L > the null's 95th percentile.  3. Stress P&L > 0.  4. At least 30 round trips.
5. P&L without its best calendar month > 0. Reported: return on the $300 the rungs lock, a year, against
~4 % cash; P&L per month; capacity-arm P&L.

## Determinism

`analysis/t3_binance_lst_wicks.py` run twice; byte-identical JSON.

## What this cannot show

Queue position at the bid (a low strictly under the bid is required, so the bid was at the front of its
level when the market traded through it); whether a UK account may trade WBETHUSDT/BNSOLUSDT (the
signed `GET /api/v3/account` → `permissions` against each symbol's `permissionSets`); a de-peg that
never comes back (the 24-hour exit sells into it).
