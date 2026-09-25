# fp218 matched protocol: the same hold length (2026-09-25)

Written before any return of this null was computed. The first screen
(`docs/agents/backtests/fp218/screen_2023.json`, sha256 `b028983e…`,
protocol `docs/agents/reviews/2026-09-25-fp218-protocol.md`, commit
`3acc6ef`) stays on record and is not a pass. It bought the USDT
perpetual on a UTC day numbered 1 through 7 and sold the next month's
first open: 84 trades, mean +811.9657 bps, null p95 +787.6951 bps,
+$682.0512. That null sold at the next month's open whenever at least
seven days remained, so the pool contained holds shorter than the
rule's 22 to 31 days. This file does not edit that protocol and does
not replace that file.

The trades do not change. The null is the only change. No daily open
after 2024-01-01 is scored here. A pass of this null is not an
adoption and is not a testing row. It earns a separate pre-registration
before any later window is scored. If this null fails, the rule is
dead and the next search does not inherit the day-of-month filter or
this hold.

The entry uses only a print that has already happened. The position is
one leg. It is not "a condition, then long or short BTC for one day or
overnight." It is not a two-leg spread. Funding cash is not added.

The rules in fp5 through fp217, and fp219 through fp224, are dead or
are other files in this search. None of their cuts is reused, and no
sign of a killed rule is flipped. The count stays 30. No trailing
window is made shorter than 90 days, because this rule does not use a
trailing window. No hourly price bar is read. The book is not read.
The three book-depth days the archive does not publish stay missing
and are not filled in.

Nothing here changes a frozen spec, arms a row, or sends an order.
Public reads only. Ten basis points a side. One hundred dollars stands
on the one leg, so the dollar result is one hundred times that leg's
net.

## Not this search

* The first MTH null. A hold of at least seven days, sold at the next month's open, is not this null.
* fp209 through fp216 (SVW, UCR, FND, CAL, FCH, MRK, LVL, SCM). A same-day two-leg spread is closed.
* fp201 through fp208. None was flipped into a long.
* fp193 through fp200. None was flipped into a long.
* fp185 through fp192. A one-day long and a one-day short stay closed, as does an overnight long or short.
* LAG6 and C3. The six-day range, the two-day hold, the three-close filter and the three-day hold stay closed.
* ENGULF, UPWICK, LIFT, REVCLOSE, LHLL, DIP, BODYGT and DELAY. An engulfing body, a wick, and a high or a low stay closed.
* The funding range held for two through fourteen days. FNCARRY stays closed. This file does not add funding cash.
* BRKHI stays void.
* MONX, XEXP, BRD, SMO, FRI7, FWK and CMS. Those seven are other files. This file is only the idea below.
* A neighbour quantile. This file does not use a percentile at all.

## Costs, window, null

Ten basis points a side on the one leg. One hundred dollars stands on
that leg. No second leg is opened and no further spread is added.
Funding cash is not added. Entries in `[2023-01-01, 2024-01-01)` UTC.
An exit may be the 2024-01-01 open when the hold reaches that day. That
open is not an entry and not a signal. A day with no print is not a
print and is not filled in. A pass is at least 30 trades, mean net
above zero, and mean net above the null below.

The null is 200 draws, seed `20250925`, index 190. A length is eligible
only when the rule itself has at least one trade of that length. For
each such length H the pool is every in-screen day whose open and the
open H days later both exist and are positive, with that later open at
or before 2024-01-01. The exit is that later open. It is not the next
month's open unless the two dates are the same day. A hold the rule
does not use is not in the pool. A hold under 22 days is not in the
pool.

One draw takes, without replacement and within each H, exactly as many
pool nets as the rule has of that H. Lengths are visited in ascending
order. Within a length the pool list is entry order, and `random.sample`
follows that list. The draw's score is the mean of the sampled nets.
The cutoff is those 200 means, sorted, at index 190. Each length's pool
has to be strictly larger than the rule's count of that length. Each
rule span has to be one of that length's pool spans. The comparison is
on the pair of timestamps, not on the entry day alone.

## The idea

**MTH.** BTCUSDT, the USDT perpetual. On a UTC day whose day number is
1 through 7, buy that open and sell the open of the next month's first
day. The date is known before the open. No price is an input. In 2023
that hold is 22 to 31 days. It is not a one-day trade and it is not an
overnight trade. Funding cash is not added.

A count of spans, taken before this freeze, with no profit of this null
computed: the rule has 84 spans. By length, the rule and the pool are
22 days 1 and 344, 23 days 1 and 343, 24 days 5 and 342, 25 days 12 and
341, 26 days 12 and 340, 27 days 12 and 339, 28 days 12 and 338, 29 days
11 and 337, 30 days 11 and 336, 31 days 7 and 335. The pool has 3395
spans. The rule is not widened if the scored count differs and stays at
least 30. If it is under 30, the rule fails as written.

## What a pass becomes

The house bar used for LS-FADE: both later sub-windows positive, above a
fresh null, positive with doubled costs, at least 30 trades, no month above
40% of the profit and the rest positive, and more than 4% a year on the $100
it locks, entries 2024-01-01 through 2026-09-24. 2023 is not part of that
bar. The half-spread, if this rule passes, is measured on the contract this
file trades after the pre-registration and before any daily open after
2024-01-01 is scored. If this rule fails, it is dead. This file does not
arm a testing row.
