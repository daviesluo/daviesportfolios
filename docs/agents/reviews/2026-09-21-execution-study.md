# Execution study — maker fills, the cooldown, the stop surface, scaling in and out, and the four together

Run 2026-09-21. Script `supabase/functions/agents/backtest_execution.ts`; raw
output `docs/agents/backtests/execution.json` (345 KB). It extends
`docs/agents/reviews/2026-09-21-allocation-study.md` (reference §3.11) and does
not repeat it: the universe of §3.7 / §3.8 is not re-run, the allocation arms
are not re-tested, the venue split is not re-argued. The subject is one row and
one row only — the row §3.11 recommends for real money, **`trend-4h` on Revolut
X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots, $100** — and the question is how
its orders reach the book.

**Two windows, never averaged.** *Window A* = the LAST third out of sample
(2025-09-10 → 2026-09-20 on the majors, a bear year). *Window B* = the MIDDLE
third out (2024-08-31 → 2025-09-09, a bull year). Each coin is split on its own
bar count, which is why AVAX and SUI's windows run 2025-09-21 → 2026-09-21 and
2024-09-21 → 2025-09-21. Every arm is ranked by the **worse** of its two
windows. 6,750 four-hour bars per major (26,991 hourly), 6,570 for AVAX and SUI.

**Fidelity — the first thing, because a study whose fidelity check is not
reported is unusable.** Four things this study varies cannot be expressed
through `run`'s arguments at all: how an order reaches the book, the trail's
anchor, a time stop, and entry/exit tranches. They are written in one variant,
`runExec`, whose body is `run`'s body copied line by line with every new branch
behind a flag. With the flags off — `exec: SHIPPED_EXEC`, `tranches: null`, the
stop surface set to `SHIPPED_STOPS` with the high-water anchor and no time stop
— it reproduces `backtest.ts`'s `run` exactly:

> **60 checks** (5 coins × 2 windows × both venues' costs × 3 parameter points:
> the shipped 20/100/3×, and the two corners of the study grid 10/50/2× and
> 30/150/4×). Largest absolute difference: **|Δreturn| 0, |ΔmaxDD| 0, |Δtrades|
> 0, |Δexposure| 0, |Δfees| 0.**

**A second check nobody asked for, and the more useful one.** The sleeve
arithmetic here is independent code from `backtest_allocation.ts`'s, and it
reproduces that study's recommended-set cells to the digit: window A **−0.33 %,
max DD 11.75 %, ret/DD −0.03, deployment 6.5 %, peak open $100, 377 days**;
window B **+12.64 %, 10.18 %, 1.24, deployment 11.3 %, $100, 387 days**. Two
independently written combiners agreeing on eight numbers is worth more than
either one's self-description. *(One transcription note, for whoever maintains
the reference: §3.11's summary table prints window B's deployment as **24 %**
where `allocation.json` — its own raw output — says **0.113**. The JSON is
right; this study gets 11.3 % from separate code. Nothing else in §3.11
disagrees with anything here.)*

**Slot convention**, as in §3.11 (`tick.ts`: `min(capital_usd / slots,
max_order_usd = 20)`). A sleeve's dollar P&L is each coin's fractional return
applied to a FIXED $20 slot, summed daily — what a live row earns, since it
re-sizes every entry to the same dollars rather than compounding.

**The intrabar assumption, stated before any number depends on it.** A resting
bid at price P is filled in a candle whose LOW reaches P. That is the live
loop's own `paperFill` (`_shared/agents_strategy.ts`), and it is optimistic in
one specific way that no candle series can fix: **it ignores the queue.** On a
book 1.5 bps wide the market printing at your price does not fill you — the
orders already resting there are filled first. Every Q1 arm is therefore run
under nine fill assumptions, from the loop's own rule to "the market must trade
50 bps through your bid before you are filled", and §1 reports where the answer
flips.

---

## 1. Q1 — could every Revolut X order rest as a maker order?

### The arithmetic first

A resting order does two things for you, and the fee is the smaller one. A
taker lifts the ask and pays 9 bps; a maker joins the bid and pays nothing. The
edge per side is therefore **2 × half-spread + 9 bps**:

| | BTC | ETH | SOL | AVAX | SUI |
|---|---|---|---|---|---|
| half-spread (§2.2 / §3.8) | 0.75 bps | 1.05 | 1.55 | 4.80 | 11.97 |
| maker edge per side | **10.5 bps** | 11.1 | 12.1 | 18.6 | **32.9** |
| of which the fee | 9 | 9 | 9 | 9 | 9 |

So on the majors the fee is 86 % of the prize and on SUI 27 %. That matters for
the verdict, because the fee is certain and the spread is only yours **if you
are filled**.

### The arms, at sleeve level ($100, five $20 slots)

Stops stay marketable unless the arm says otherwise. "Missed" is a resting
order cancelled at its deadline; the rule then re-signals on a later bar if its
conditions still hold.

| arm | A ret | A DD | A ret/DD | A fills (maker) | A missed | A fees | B ret | B DD | B ret/DD | B fills (maker) | B missed | B fees | beats shipped on both |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **taker (shipped)** | **−0.33 %** | 11.75 % | **−0.03** | 98 (0) | 0 | $1.689 | **+12.64 %** | 10.18 % | **1.24** | 137 (0) | 0 | $2.619 | — |
| rest-1h-cancel | +5.71 % | 11.98 % | 0.48 | 97 (50) | 1 | $0.809 | +13.32 % | 10.03 % | 1.33 | 135 (69) | 4 | $1.277 | yes |
| rest-2h-cancel | +5.71 % | 11.98 % | 0.48 | 97 (50) | 1 | $0.809 | +14.89 % | 9.90 % | 1.50 | 135 (69) | 2 | $1.289 | yes |
| rest-4h-cancel | +5.71 % | 11.98 % | 0.48 | 97 (50) | 1 | $0.809 | +13.48 % | 10.01 % | 1.35 | 137 (70) | 1 | $1.295 | yes |
| rest-8h-cancel | +6.56 % | 11.15 % | 0.59 | 97 (50) | 0 | $0.815 | +12.46 % | 10.10 % | 1.23 | 137 (70) | 1 | $1.291 | **no** (B) |
| rest-1h-cross | +6.28 % | 11.42 % | 0.55 | 97 (49) | 0 | $0.830 | +14.01 % | 9.97 % | 1.41 | 137 (67) | 0 | $1.350 | yes |
| rest-2h-cross | +6.13 % | 11.57 % | 0.53 | 97 (49) | 0 | $0.829 | +13.88 % | 9.98 % | 1.39 | 137 (68) | 0 | $1.333 | yes |
| rest-4h-cross | +6.42 % | 11.29 % | 0.57 | 97 (49) | 0 | $0.831 | +13.41 % | 10.02 % | 1.34 | 137 (69) | 0 | $1.313 | yes |
| rest-8h-cross | +6.56 % | 11.15 % | 0.59 | 97 (50) | 0 | $0.815 | +12.40 % | 10.11 % | 1.23 | 137 (69) | 0 | $1.308 | **no** (B) |
| rest-1h-cancel-chase | +5.71 % | 11.98 % | 0.48 | 97 (50) | 1 | $0.809 | +13.32 % | 10.03 % | 1.33 | 135 (69) | 4 | $1.277 | yes |
| rest-4h-cancel-chase | +6.31 % | 11.40 % | 0.55 | 97 (50) | 0 | $0.813 | +13.94 % | 9.98 % | 1.40 | 137 (70) | 0 | $1.297 | yes |
| rest-4h-cross-chase | +6.31 % | 11.40 % | 0.55 | 97 (50) | 0 | $0.813 | +13.94 % | 9.98 % | 1.40 | 137 (70) | 0 | $1.297 | yes |
| rest-4h-cancel, **entries only** | +5.68 % | 11.98 % | 0.47 | 97 (49) | 1 | $0.830 | +13.45 % | 10.03 % | 1.34 | 137 (69) | 1 | $1.317 | yes |
| rest-4h-cancel, **rule exits only** | −0.31 % | 11.75 % | −0.03 | 98 (1) | 0 | $1.669 | +12.66 % | 10.16 % | 1.25 | 137 (1) | 0 | $2.599 | yes (by $0.02) |
| rest-1h-cancel + **maker stop** | +9.82 % | 11.29 % | 0.87 | 97 (97) | 1 | **$0.000** | +17.62 % | 9.78 % | 1.80 | 135 (135) | 4 | **$0.000** | yes |
| rest-4h-cancel + **maker stop** | +9.82 % | 11.29 % | 0.87 | 97 (97) | 1 | **$0.000** | +18.14 % | 9.73 % | 1.86 | 137 (137) | 1 | **$0.000** | yes |

**The first thing this table says has nothing to do with makers.** Look at the
"rule exits only" row: resting the rule's exits changes the sleeve by **2 basis
points** and saves **$0.02** of fees, because under the shipped configuration
*there are almost no rule exits*. Window A's 98 fills are 49 entries and 49
exits, of which **48 are protective stops and one is a rule exit**; window B's
137 are 69 entries and 68 exits, **67 stops and one rule exit** (one position
is still open when the window ends). The "rule exits only" arm confirms it from
the other side: it rests every rule exit and makes exactly **one** maker fill
per window. The rulebook's own exit conditions essentially never get to act —
which is the whole of question 3, found here by accident.

**Entries missed are negligible, and that is itself the problem.** Under the
loop's own fill rule the resting bid fills in the FIRST hour, every time: the
median signal-to-fill delay is **0 hours for every coin in both windows**, and
0–4 entries out of ~50 are missed. That is not a measurement of adverse
selection; it is the model saying "the price touched your bid, so you were
filled", which is exactly what a queue makes untrue.

### Where the gain actually comes from — the decomposition

The same arm priced on a synthetic Revolut X whose **maker fee is 9 bps**: a
resting order still buys the bid and sells the ask but saves nothing in fees,
so the difference from the taker baseline is spread capture alone, and what the
real 0 % adds on top is the fee.

| arm | window | spread capture | fee saving | total |
|---|---|---|---|---|
| rest-1h-cancel | A | **+5.13 pts** | +0.91 pts | +6.04 pts |
| rest-1h-cancel | B | **−0.56 pts** | +1.24 pts | +0.68 pts |
| rest-4h-cancel | A | +5.13 | +0.91 | +6.04 |
| rest-4h-cancel | B | −0.43 | +1.27 | +0.84 |
| rest-4h-cross | A | +5.86 | +0.89 | +6.75 |
| rest-4h-cross | B | −0.48 | +1.25 | +0.77 |

The fee saving is stable and small — **$0.88–$1.34 on $100 a year**, which is
what 9 bps × ~50 round trips has to be. The "spread capture" is not stable at
all: +5.1 points in one window and **negative** in the other. It is not really
spread capture. It is a *path* effect — a resting bid enters a few basis points
lower, so the 8 % floor and the 3×ATR trail sit a few basis points lower, so
some positions are not stopped out. In window A, where the stops are destroying
the row (see §3), a slightly lower entry is worth five points; in window B it
costs half a point. **Most of what the maker arms appear to earn is not
execution at all — it is a pathological stop being dodged**, and §5 tests that
directly.

### The fill assumption, swept

The only dial that can express "the queue ahead of me did not clear" is the
distance the market must trade THROUGH the resting price before it counts as a
fill. At 0 it is the loop's own `paperFill`.

| assumption | rest-1h-cancel A / B | rest-4h-cross A / B | maker-stop A / B | maker arms still beating taker on both |
|---|---|---|---|---|
| **1h/0** — low reaches the bid (the loop's rule) | +5.71 / +13.32 | +6.42 / +13.41 | +9.82 / +18.14 | all |
| 1h/1 spread through | +5.03 / +13.32 | +5.64 / +13.41 | +9.74 / +18.10 | all |
| 1h/2 spreads through | +5.83 / +12.86 | +5.64 / +12.74 | +9.24 / +16.14 | all but rest-4h-cancel |
| 1h/**+2 bps** through | +5.06 / +13.32 | +5.75 / +13.41 | +9.14 / +18.10 | all |
| 1h/**+5 bps** through | +5.86 / +13.32 | +5.75 / +13.41 | +8.42 / +17.80 | all |
| 1h/**+10 bps** through | +7.25 / +14.30 | +5.68 / +13.41 | +7.98 / +17.46 | all |
| 1h/**+20 bps** through | +1.34 / +10.77 | +3.57 / +10.99 | +6.10 / +12.81 | **only the maker-stop arm** |
| 1h/**+50 bps** through | +0.70 / +11.77 | +2.67 / +9.13 | +0.17 / +7.40 | **none** |
| 4h/0 — the loop's rule on the 4-hour bar | +5.71 / +13.48 | +6.42 / +13.41 | +10.44 / +21.13 | all |

**The break-even is between +10 and +20 bps.** If a resting bid at the Revolut
X UK touch is filled whenever the market trades within 10 bps through it,
maker-only wins on both windows. If it takes 20 bps of adverse move to clear
the queue ahead of you, it loses on both. At +50 bps, 47 of ~97 entries in
window A are never filled and the arm is flat. **Nothing in this repository
measures which of those is true**, and nothing can: the candles are Coinbase's,
the bid and the ask are synthetic offsets from them, and Revolut X's own book
depth at the touch has never been sampled. The one thing that would settle it
is a quarter of paper orders actually resting on the UK book.

### Resting the *stop* is not the same question, and this model cannot answer it

The two best arms in the table are the ones where the protective stop also
rests at the ask and is walked down. They pay **zero fees** and add 3–5 points
over the other maker arms. Treat that number with suspicion, for a reason the
code makes explicit: at hourly resolution a sale resting at that hour's ask
fills whenever the hour ticks up by half a spread, which is nearly always. So
the arm as modelled measures **a one-hour delay plus half a spread of price
improvement**, and it does NOT measure the thing that makes a resting
protective exit dangerous — a fall in which no bid comes back and the order
never fills at all. Window A contains a 47 % bear market and no such event. A
stop that cannot find a bid is exactly what the marketable exit in §4.11 exists
for, and this study has not tested it.

*(An earlier cut of this script armed the walked stop from the bar's FIRST hour
rather than from the hour after the level was breached, and reported +23.8 % /
+40.7 %. That was look-ahead: the sale was asking a price the market had not yet
fallen away from. It is recorded here because the corrected figure is less than
half of it, and because the same mistake is easy to make again.)*

### Q1 in one sentence

**Yes on paper and no in practice:** resting every Revolut X order beats 9 bps
taker on both windows under the loop's own fill rule (+6.0 / +0.7 points, fees
down from $1.69 / $2.62 to $0.81 / $1.28 on $100), but five of those six points
in window A are a lower entry price dodging a stop this study also recommends
removing — and once that stop is fixed (§5) the maker edge falls to **+1.6
points in A and −0.2 in B, which fails the two-window bar**, while the whole
result reverses if a filled bid needs 20 bps of adverse move rather than 0.

---

## 2. Q2 — the re-entry cooldown

`SHIPPED_STOPS.reentryBars = 2`: after ANY exit the rule waits two of its own
bars — 8 hours on `trend-4h` — before buying that coin again. Everything else
shipped.

| reentryBars | A ret | A DD | A ret/DD | A fills | B ret | B DD | B ret/DD | B fills | worse window |
|---|---|---|---|---|---|---|---|---|---|
| 0 | −0.33 % | 11.75 % | −0.03 | 98 | +11.49 % | 10.28 % | 1.12 | 139 | −0.03 |
| 1 | −0.33 % | 11.75 % | −0.03 | 98 | +11.49 % | 10.28 % | 1.12 | 139 | −0.03 |
| **2 (shipped)** | **−0.33 %** | 11.75 % | **−0.03** | 98 | **+12.64 %** | 10.18 % | **1.24** | 137 | **−0.03** |
| 3 | +0.44 % | 11.75 % | 0.04 | 96 | +12.64 % | 10.18 % | 1.24 | 137 | 0.04 |
| 4 | +0.44 % | 11.75 % | 0.04 | 96 | +14.13 % | 8.93 % | 1.58 | 135 | 0.04 |
| 6 | +0.27 % | 11.91 % | 0.02 | 96 | +15.01 % | 8.84 % | 1.70 | 131 | 0.02 |
| 8 | +0.79 % | 11.40 % | 0.07 | 94 | +12.89 % | 8.89 % | 1.45 | 131 | **0.07** |

**It is a plateau, not a spike, and the plateau is nearly flat.** The whole
grid spans **1.12 points of return and 0.10 of ret/DD in window A**, and 3.5
points / 0.58 in window B. The shipped value ranks **5th of 7 in A and 4th of 7
in B** — mid-grid, which is where §3.10 found the rotation's seeded point and
said the same thing about it.

Two details worth having. First, **0, 1 and 2 are identical in window A and 0
and 1 are identical in both** — the rule simply does not want to re-enter that
fast, so the first two steps of the grid are inert. Second, the variation that
does exist is almost entirely **one coin**: across the whole grid SOL, AVAX and
SUI never change at all in window A, and BTC accounts for the move from −13.6 %
to −10.2 %. A grid that moves one coin's 16 round trips is not measuring the
parameter, it is measuring those 16 round trips.

Three of six alternatives beat the shipped value on both windows against **1.5
by chance** (p ≥ 0.17 even assuming independence) — i.e. inside chance.

### Q2 in one sentence

**Leave it at 2:** the cooldown is on a flat plateau where the entire 0–8 grid
spans 1.1 points of return in the bear window, 2 ranks mid-grid (5th and 4th of
7), the first two grid steps are literally inert, and the three arms that beat
it on both windows are exactly the number six looks produce by chance.

---

## 3. Q3 — the stop surface

`floor ∈ {6, 8, 10, 12, 15 %, none} × trail ∈ {2, 3, 4, 6×ATR, none} × anchor ∈
{high since entry, entry price} × time stop ∈ {none, 10, 20, 40 bars}`. With no
trail the anchor is meaningless, so those duplicates are dropped: **216
settings**, each run on both windows on all five coins — 2,160 sleeve-coin
runs.

### What the rulebook already does, which decides everything below

`ruleDecision` in `_shared/agents_strategy.ts` already exits when

```
close < highWater − atrStop × ATR          (atrStop = 3, evaluated at each bar CLOSE)
```

So the protective layer this question grids is **a second copy of the same
trail, read against the bar's LOW instead of its close**. It does not add
protection the rule lacks. It adds a wick-sensitive version of protection the
rule already has — and it gets there first: under the shipped configuration
**48 of 49 exits in window A and 67 of 68 in window B are protective stops**,
so the rulebook's own trail almost never fires (one rule exit per window, in both).

### Where the shipped pair sits in its own grid

| | window A | window B |
|---|---|---|
| shipped (8 % floor, 3×ATR trail, high-water anchor, no time stop) | −0.33 %, DD 11.75 %, **ret/DD −0.03** | +12.64 %, DD 10.18 %, **1.24** |
| rank among the 216 settings | **202nd of 216** | 119th of 216 |
| share of the grid that beats it | **93.1 %** | 54.6 % |
| the grid's own median | +8.42 %, ret/DD 0.74 | +14.55 %, 1.64 |
| worst drawdown ANYWHERE in the grid | 13.55 % | 12.58 % |

The last row is the one to read twice. **No setting in the entire grid — no
floor, no trail, no anchor, no time stop, including removing every protective
exit — produces a drawdown above 13.6 %**, against §4.15's 35 % bar. Whatever
is controlling this sleeve's drawdown, it is not the protective stops.

### One change at a time

| setting | A ret | A DD | A ret/DD | A fills | A stops | B ret | B DD | B ret/DD | B fills | B stops |
|---|---|---|---|---|---|---|---|---|---|---|
| **8 % floor, 3× trail, high (shipped)** | **−0.33 %** | 11.75 % | **−0.03** | 98 | 48 | **+12.64 %** | 10.18 % | **1.24** | 137 | 67 |
| floor off, trail unchanged | +5.03 % | 11.75 % | 0.43 | 97 | 47 | +12.46 % | 10.33 % | 1.21 | 137 | 67 |
| **trail off, floor unchanged** | **+8.03 %** | 11.28 % | 0.71 | 85 | **2** | **+20.08 %** | 10.47 % | 1.92 | 115 | **9** |
| anchor at entry instead of the high | +7.51 % | 11.81 % | 0.64 | 89 | 10 | +20.91 % | 10.49 % | 1.99 | 115 | 18 |
| trail 4× instead of 3× | +7.19 % | 11.33 % | 0.63 | 87 | 12 | +17.98 % | 10.75 % | 1.67 | 117 | 26 |
| **no protective layer at all** | **+13.73 %** | 11.28 % | **1.22** | 84 | 0 | **+20.34 %** | 11.38 % | 1.79 | 115 | 0 |
| 10 % floor, no trail | +13.73 % | 11.28 % | 1.22 | 84 | 0 | +19.92 % | 10.75 % | 1.85 | 115 | 2 |
| shipped + a 10-bar time stop | +2.62 % | 10.39 % | 0.25 | 118 | 20 | +8.52 % | 7.64 % | 1.12 | 181 | 29 |

The intrabar trail is the expensive half: switching it off takes the stop count
from 48 to 2 in window A and from 67 to 9 in B, and adds 8.4 and 7.4 points.
Removing the floor instead is worth +5.4 points in A and −0.2 in B. Both off: **+14.1 and +7.7
points, with the bear-window drawdown IMPROVING from 11.75 % to 11.28 %.**

**Per coin, so that one coin cannot carry it**: dropping the protective layer
improves **9 of the 10 coin-windows**; the exception is SUI in window B
(+3.0 % → −8.4 %). Window A: BTC −13.6 → −10.7, ETH −10.3 → −8.0, SOL +13.3 →
+17.6, AVAX +12.1 → +34.1, SUI −10.5 → +33.7. Window B: BTC +17.0 → +18.2, ETH
+49.4 → +79.4, SOL −10.9 → +6.1, AVAX −3.3 → +6.7, SUI +3.0 → −8.4.

**Time stops: no.** 162 of the 216 settings carry one, and the best worse-window
ret/DD among them is 1.15 against 1.22 without. A 10-bar stop raises the trade
count from 98 to 118 in A and 137 to 181 in B and pays for it.

### Chosen on one window, scored on the other — both directions

This is the test §3.10 declined to run, and it is the only part of Q3 that is
not scored on the data that chose it. **Window B is the middle third and window
A the last third, so choosing on B and scoring on A is a real walk-forward — B's
data existed before A began. The reverse is look-ahead**, and is labelled as a
bound, not as a test.

| | chosen setting | on the choosing window | scored on the other | shipped, there | rank there |
|---|---|---|---|---|---|
| **chosen on B → scored on A (walk-forward)** | 6 % floor, 2× trail, **entry anchor**, no time stop | 2.45 | **0.84** (ret +9.80 %, DD 11.61 %) | −0.03 | 93 / 216 |
| chosen on A → scored on B (look-ahead) | 10 % floor, 4× trail, entry anchor, no time stop | 1.22 | 1.89 (ret +20.21 %, DD 10.72 %) | 1.24 | 46 / 216 |

And the neighbourhood, not just its luckiest member — the top *k* on the
choosing window, each scored on the other:

| k | B → A: median (min – max) | A → B: median (min – max) |
|---|---|---|
| 1 | 0.84 | 1.89 |
| 3 | 0.80 (0.80 – 0.84) | 1.85 (1.84 – 1.89) |
| 5 | 0.80 (0.80 – 0.84) | 1.85 (1.80 – 1.89) |
| 10 | 0.80 (**0.70** – 0.84) | 1.85 (1.74 – 1.91) |
| shipped | **−0.03** | **1.24** |

**All ten survive, in both directions.** The worst of the ten settings chosen
on window B still scores 0.70 on window A against the shipped pair's −0.03.
That is not one grid point winning a search; it is a neighbourhood.

### The control

216 settings, 215 arms, **116 beat the shipped pair on both windows against
53.75 by chance**. But the honest reading of that number is *not* "116
independent discoveries". Those 216 settings are variants of one idea — make
the intrabar stop looser or take it away — and they nearly all say the same
thing because it is the same thing. The count that matters is the
out-of-sample one above: the whole top-10 neighbourhood chosen on the earlier
window beats the shipped pair on the later one.

### Q3 in one sentence

**Yes, something survives being chosen out of sample, and the shipped pair is
not inside the plateau — it is 202nd of 216 in the bear window, beaten by 93 %
of its own grid, and beaten by every one of the top ten settings chosen on the
window that precedes it;** the mechanism is that the loop's intrabar 3×ATR
trail duplicates the rulebook's own close-based 3×ATR trail and fires first on
wicks, taking 48 of 49 exits in window A, and switching it off adds 8.4 and 7.4
points while *lowering* the bear-window drawdown.

---

## 4. Q4 — all-in / all-out against scaling

Every variant keeps the $20 slot and the shipped stops and execution, and
changes only how that $20 is spent and taken back. Tranche triggers are
measured in ATR(14) from the first fill. A pullback add is charged at its own
limit level; a breakout add takes `run`'s gap-through convention (the level, or
the bar's open when it gapped past it). Both pay the venue's ordinary fill fee,
so this question does not confound with Q1.

| variant | A ret | A ret/DD | B ret | B ret/DD | worse | A turnover | B turnover | A fees | B fees | smallest order |
|---|---|---|---|---|---|---|---|---|---|---|
| **in 2 on breakout 1×ATR (pyramid)** | +0.61 % | **0.06** | +14.15 % | 2.01 | **0.06** | 14.9×/y | 23.1×/y | $1.383 | $2.197 | $10.00 |
| in 3 on breakout 1×ATR (pyramid) | +0.33 % | 0.04 | +13.01 % | 2.12 | 0.04 | 12.6 | 20.0 | $1.171 | $1.903 | $6.67 |
| in 3 on breakout 0.5×ATR (pyramid) | +0.16 % | 0.02 | +13.92 % | 2.02 | 0.02 | 14.1 | 22.1 | $1.304 | $2.103 | $6.67 |
| **all-in / all-out (shipped)** | **−0.33 %** | **−0.03** | **+12.64 %** | **1.24** | **−0.03** | 18.2 | 27.5 | $1.689 | $2.619 | $20.00 |
| in 2 on pullback 1×ATR | −0.47 % | −0.06 | +3.02 % | 0.38 | −0.06 | 14.8 | 19.2 | $1.368 | $1.825 | $10.00 |
| in 2 breakout 1, out half at 3×ATR | −0.94 % | −0.11 | +8.08 % | 1.38 | −0.11 | 15.1 | 22.4 | $1.395 | $2.135 | $10.00 |
| in 3 on pullback 0.5×ATR | −1.36 % | −0.17 | +1.70 % | 0.24 | −0.17 | 14.4 | 17.8 | $1.333 | $1.692 | $6.67 |
| in 1, out a third at 2×ATR | −1.95 % | −0.19 | +8.01 % | 0.87 | −0.19 | 18.3 | 27.2 | $1.696 | $2.587 | $6.67 |
| in 2 on pullback 0.5×ATR | −1.96 % | −0.20 | +7.41 % | 0.89 | −0.20 | 16.1 | 22.1 | $1.495 | $2.099 | $10.00 |
| in 1, out half at 3×ATR | −1.97 % | −0.20 | +6.53 % | 0.73 | −0.20 | 18.4 | 26.8 | $1.702 | $2.549 | $10.00 |
| in 1, out half at 2×ATR | −2.72 % | −0.29 | +5.68 % | 0.65 | −0.29 | 18.3 | 27.0 | $1.700 | $2.571 | $10.00 |
| in 2 pullback 0.5, out half at 2×ATR | −3.11 % | −0.39 | +1.77 % | 0.25 | −0.39 | 16.2 | 21.7 | $1.504 | $2.066 | $10.00 |

**Scaling OUT is unambiguously bad** — every profit-target variant loses to
all-in/all-out on both windows, which for a long-only trend rule is the
expected result: taking half off at +2×ATR is selling exactly the trades the
rule exists to hold. **Scaling IN on pullbacks is bad too**, on both windows,
in all three forms. **Pyramiding into a further breakout beats all-in/all-out on
both windows** in all three of its forms — but three arms of eleven passing
against **2.75 by chance (p = 0.54)** is precisely chance, and the win in
window A is +0.9 points on a sleeve whose whole grid spans a few points.

Pyramiding does do one unambiguous thing: it cuts turnover and fees by **16–31 %**
depending on the variant (two tranches −16 to −18 %, three −27 to −31 %), because part
of the slot is only committed once the position is already right.

### Legality at $20 a slot

| | Revolut X majors (`min_order_size_quote` $0.10) | Revolut X AVAX / SUI | Kraken `costmin` $0.50 | Kraken `ordermin` (worst case $16.26) |
|---|---|---|---|---|
| $20 (all-in) | legal, 200× over | **unmeasured** | legal | legal |
| $10 (halves) | legal, 100× over | **unmeasured** | legal | **illegal** |
| $6.67 (thirds) | legal, 67× over | **unmeasured** | legal | **illegal** |

Nothing is impossible at this account size **on Revolut X for the three
majors**. Two honest gaps: §2.1's probe read `min_order_size_quote` for BTC,
ETH and SOL only, so a $6.67 AVAX or SUI tranche is *assumed* legal and has not
been checked — the probe reads pair config for every symbol on an active row
and would settle it in one call. On Kraken (which runs no real money) every
tranche variant falls below the worst of the measured `ordermin` range
$2.53–$16.26, so a tranche design could not be carried across to the Kraken
twin without checking each pair. The "smallest order" column above is the
planned tranche; the smallest one the backtest actually placed is lower
($4.41–$16.40) because the backtest's slot compounds down after losses where a
live row re-sizes to $20 every time.

### Q4 in one sentence

**Keep one order in and one order out:** scaling out at a profit target and
scaling in on pullbacks both lose on both windows, pyramiding into a further
breakout wins on both but by +0.9 points in the bear window with three passes
out of eleven arms against 2.75 by chance (p = 0.54), and once the stop surface
is fixed (§5) pyramiding *loses* to plain all-in on window A.

---

## 5. Q5 — the interaction

The best answer to each question, by the worse of its two windows, then the
combinations. Everything in this table is scored on both windows; only the row
marked walk-forward was *chosen* without looking at window A.

| configuration | A ret | A DD | A ret/DD | B ret | B DD | B ret/DD | worse |
|---|---|---|---|---|---|---|---|
| conservative stops + maker entries and rule exits | +15.37 % | 11.03 % | **1.39** | +19.73 % | 10.50 % | 1.88 | **1.39** |
| conservative stops + maker everything incl. the stop | +15.37 % | 11.03 % | 1.39 | +20.97 % | 10.11 % | 2.07 | 1.39 |
| Q3 best alone (10 % floor, 4× trail, entry anchor) | +13.73 % | 11.28 % | 1.22 | +20.21 % | 10.72 % | 1.89 | 1.22 |
| Q2 + Q3 | +13.73 % | 11.28 % | 1.22 | +22.00 % | 9.22 % | 2.39 | 1.22 |
| **conservative: 10 % floor, no intrabar trail** | **+13.73 %** | 11.28 % | **1.22** | **+19.92 %** | 10.75 % | **1.85** | **1.22** |
| conservative + reentryBars = 8 | +13.73 % | 11.28 % | 1.22 | +21.75 % | 9.24 % | 2.35 | 1.22 |
| Q1 + Q2 + Q3 + Q4 (everything) | +12.31 % | 11.01 % | 1.12 | +21.50 % | 7.42 % | 2.90 | 1.12 |
| Q3 + Q4 | +11.25 % | 11.19 % | 1.01 | +21.08 % | 8.18 % | 2.58 | 1.01 |
| Q2 + Q3 + Q4 | +11.25 % | 11.19 % | 1.01 | +22.49 % | 7.78 % | 2.89 | 1.01 |
| conservative + pyramid | +11.25 % | 11.19 % | 1.01 | +20.96 % | 8.17 % | 2.57 | 1.01 |
| Q1 best alone (maker incl. stop) | +9.82 % | 11.29 % | 0.87 | +17.62 % | 9.78 % | 1.80 | 0.87 |
| **Q3 chosen on window B only (walk-forward)** | **+9.80 %** | 11.61 % | **0.84** | +21.38 % | 8.72 % | 2.45 | 0.84 |
| Q2 + Q4 | +1.40 % | 9.74 % | 0.14 | +13.52 % | 7.88 % | 1.72 | 0.14 |
| Q2 best alone (reentryBars = 8) | +0.79 % | 11.40 % | 0.07 | +12.89 % | 8.89 % | 1.45 | 0.07 |
| Q4 best alone (pyramid 2 × 1×ATR) | +0.61 % | 10.14 % | 0.06 | +14.15 % | 7.03 % | 2.01 | 0.06 |
| **shipped** | **−0.33 %** | 11.75 % | **−0.03** | **+12.64 %** | 10.18 % | **1.24** | **−0.03** |

Three things fall out.

1. **The combination is not additive, it is dominated by one term.** Q3 alone
   accounts for the entire move: +13.73 / +19.92 against the shipped −0.33 /
   +12.64. Q2 adds nothing in window A (identical to four significant figures)
   and ~1.8 points in B. Q4 *subtracts* 2.5 points in window A once the stop is
   fixed — the pyramid arm that beat the shipped configuration stops beating
   the conservative one.
2. **Q1's edge largely evaporates once Q3 is answered**, which is what §1's
   decomposition predicted. On top of the conservative stops, maker entries and
   rule exits are worth **+1.64 points in A and −0.19 in B** — a one-window win
   and a one-window loss, which by this study's own rule is not a win.
3. **Every arm in this table beats the shipped configuration on both windows**
   (15 of 15 against 3.75 by chance) **because they all contain the same
   change.** That is not fifteen findings.

### Q5 in one sentence

**The combination survives, but only because it is one finding wearing four
hats:** the stop surface carries all of it, the cooldown is worth nothing in
the bear window, pyramiding costs 2.5 points in the bear window once the stop
is fixed, and maker execution shrinks to a one-window win — so what should change is Q3's
parameter, alone, and the other three should not.

---

## The multiple-comparisons control, in one place

| search | arms | beat the shipped configuration on BOTH windows | a coin-flip null gives | P(≥ that many), independence assumed |
|---|---|---|---|---|
| Q1 execution arms | 15 | 13 | 3.75 | 9.2 × 10⁻⁷ |
| Q2 cooldowns | 6 | 3 | 1.50 | 0.169 |
| Q3 stop surfaces | 215 | 116 | 53.75 | 1.3 × 10⁻¹⁹ |
| Q4 tranche variants | 11 | 3 | 2.75 | 0.545 |
| Q5 combinations | 15 | 15 | 3.75 | 9.3 × 10⁻¹⁰ |
| **study-wide** | **262** | **150** | **65.5** | 1.5 × 10⁻²⁸ |

Read the right-hand column with the note the script attaches to it: the
expected count is exact under the null however correlated the arms are, but the
tail probability assumes the arms are INDEPENDENT, which variants of one rule
are not. **Q3's 215 arms are one idea, not 215**, and Q5's 15 all contain Q3.
The two searches whose arms genuinely differ from one another — Q2 and Q4 — are
the two that land squarely inside chance (p = 0.17 and p = 0.54), which is the
result to trust in both cases. Q1's 13 of 15 is also one idea (rest at the
touch instead of crossing it) repeated at different deadlines and timeouts.

The number that carries actual weight is none of these. It is §3's
out-of-sample neighbourhood: the top ten stop settings chosen on window B, each
scored on window A, all beating the shipped pair, worst of the ten 0.70 against
−0.03.

---

## Verdicts

1. **Q1 — maker-only execution: not adopted, and not rejected on its merits
   either.** Under the loop's own fill rule it wins both windows (+6.04 / +0.68
   points, fees $1.69 → $0.81 and $2.62 → $1.28 on $100, 0–4 entries missed of
   ~50). But the decomposition says the fee is worth only +0.9 / +1.2 points and
   the rest is a lower entry price avoiding a stop that §3 says to remove; on
   top of the corrected stop surface the maker edge is **+1.64 in A and −0.19 in
   B, a one-window win**. The break-even adverse-selection assumption is between
   +10 and +20 bps through the bid, and **nothing here or anywhere in this
   repository measures which side of that Revolut X's UK book is on.** The
   recommendation is therefore to leave the loop taking the touch and to
   *measure* instead: rest a paper bid at the touch alongside the live taker
   order and record whether it fills, how long it takes and where the market
   went — a quarter of that settles the question in a way no candle series can.
   Resting the protective STOP is a separate question this study did NOT answer
   (§1's last subsection) and should not be changed on these numbers.
2. **Q2 — the re-entry cooldown: leave `reentryBars = 2`.** The 0–8 grid spans
   1.1 points of return in window A and the shipped value ranks 5th of 7 there
   and 4th of 7 in B — a flat plateau, not a spike. 0 and 1 are inert (the rule
   does not want to re-enter that fast), and what variation exists comes from
   BTC's 16 round trips. Three of six arms beat it on both windows against 1.5
   by chance.
3. **Q3 — the stop surface: change it, and it is the one change this study
   recommends.** The shipped pair is **202nd of 216 in window A**, beaten by
   93 % of its own grid there and 55 % in B, and beaten out of sample by every
   one of the top-ten settings chosen on the window that precedes it (worst
   0.70 against −0.03). The mechanism is concrete: the loop's intrabar 3×ATR
   trail duplicates `ruleDecision`'s own close-based 3×ATR trail and fires
   first, taking 48 of 49 exits in window A and 67 of 68 in B. **The
   recommendation is the conservative member of the plateau — keep a hard
   floor, widened to 10 %, and drop the intrabar ATR trail** (`stopsForKind`
   returning `atrStop: null` for the trend rules). That is +14.1 points in A
   and +7.3 in B, with the bear-window drawdown falling from 11.75 % to 11.28 %,
   and the floor then fires 0 times in A and 2 in B — which is what a disaster
   brake should do. Its operational cost is that the row holds longer: **fills
   fall from 98 to 84 (A) and 137 to 115 (B), turnover from 18.2× to 15.6× and
   27.5× to 24.6×, fees from $1.69 to $1.45 and $2.62 to $2.34 — and deployment
   RISES from 6.5 % to 8.9 % of the year (A) and 11.3 % to 14.5 % (B)**. Peak
   simultaneous open notional is still $100, so `max_exposure_usd` and
   `max_order_usd` need nothing raised; the row is simply in the market a third
   more of the time, which is where the exposure the trail was removing has
   gone. Removing the floor as well is identical in A and +0.4 points
   of *return* in B, but worse by ret/DD there (1.79 against 1.85) because the
   drawdown rises from 10.75 % to 11.38 % — and the floor is the only protective
   exit that acts when the rulebook cannot. Keep it.
4. **Q4 — all-in / all-out: keep it.** Scaling out at a profit target loses on
   both windows in all four forms; scaling in on pullbacks loses on both in all
   three. Pyramiding into a further breakout wins on both — by +0.9 points in
   window A, three arms of eleven against 2.75 by chance (p = 0.54) — and turns
   *negative* against plain all-in once the stop surface is corrected. Every
   tranche is a legal Revolut X order for the three majors ($6.67 against a
   $0.10 minimum); AVAX and SUI's minimums have never been read and no tranche
   design should be carried to the Kraken twin, where $10 and $6.67 are below
   the worst measured `ordermin`.
5. **Q5 — the interaction: one finding, not four.** The best combination
   (conservative stops + maker execution, ret/DD 1.39 / 1.88) beats the shipped
   configuration comfortably, and 15 of 15 combinations do — but they all
   contain the same stop change, which alone accounts for the whole move. The
   cooldown contributes nothing in the bear window, the pyramid subtracts 2.5
   points there, and maker execution shrinks to a one-window win. **Change the
   stop surface and change nothing else.**

---

## Caveats — all of them

- **Window A is one bear year and window B is one bull year.** Nothing here
  estimates a return. The two windows disagree about most arms, which is the
  finding rather than a defect.
- **Q1's answer is not measurable from this data and the study says so twice.**
  The candles are Coinbase's; the bid and the ask are synthetic offsets from
  them at half-spreads measured in one 20-minute snapshot (§2.2, §3.8). Whether
  a resting bid at the Revolut X UK touch would have been filled depends on
  queue position, which no candle contains. The loop's own `paperFill` says the
  bid fills in the first hour with a **median delay of 0 hours for every coin
  in both windows**, which should be read as the model's limit, not as a
  measurement.
- **The break-even margin (+10 to +20 bps) is itself a crude proxy.** "The
  market must trade N bps through your price" is not what a queue does; it is
  the only thing a candle can express. A real answer needs paper orders resting
  on the real book.
- **The walked-stop arm does not measure what makes a resting stop dangerous.**
  At hourly resolution a sale resting at the ask fills whenever the hour ticks
  up half a spread, so the arm measures a one-hour delay plus price improvement
  and never a fall in which no bid returns. An earlier cut of the script had
  this arm armed from the wrong hour and reported more than double the corrected
  figure; the mistake is recorded in §1 because it is easy to repeat.
- **Resting orders longer than one bar are modelled; re-quoting at the loop's
  real cadence is not.** The live loop re-quotes after 3 minutes when the touch
  has moved ≥ 5 bps, at most 5 times, and cancels at 1 hour. The "chase" arms
  re-quote hourly, which is the finest the data allows — about the same number
  of re-quotes over a bar, at four times the latency.
- **Q3's grid is one idea.** 216 settings that all loosen or remove the same
  stop are not 216 independent looks, and the study-wide control (150 of 262
  against 65.5) is inflated by that. The load-bearing number is the
  out-of-sample neighbourhood, not the count.
- **Q3's A→B direction is look-ahead** and is labelled as such: window A is the
  future relative to window B. Only B→A is a walk-forward.
- **No setting anywhere in Q3's grid produced a drawdown above 13.6 %, and
  neither window contains a gap-down event.** The case for keeping a hard floor
  is therefore *not* in these numbers — it is that the two windows cannot
  contain the event the floor exists for. A study that recommended removing all
  protective exits on this evidence would be recommending it on the absence of
  evidence.
- **Removing the intrabar trail is a governance change as well as a parameter
  change.** §4.11's protective layer is the part that "sells without asking the
  model". Narrowing it to a floor means the trend rule's own bar-close exit is
  what handles an adverse move for up to four hours, and a live order that fails
  to place (§4.17, B6) leaves the position exposed for that bar rather than that
  minute. The numbers say the trail costs money; they do not say the exposure it
  removes is acceptable, and that is Davies' call, not a backtest's.
- **Sample sizes are small.** The sleeve fires 42–49 round trips per window;
  per coin it is 5–20. AVAX and SUI fire 5–12. Nothing under about twenty round
  trips separates a rule from luck, and Q2's whole window-A grid moves on BTC's
  16 round trips.
- **Q4's tranche triggers are one functional form.** Adds at k × ATR from the
  first fill, targets at k × ATR above it; three k values each. A different form
  — a fixed percentage, a re-test of the breakout level, a volatility-scaled
  target — is untested, and "pyramiding is inside chance" is a statement about
  these eleven variants.
- **Q4 charges every tranche the ordinary taker fill fee**, including the
  pullback adds that would naturally rest as limits. That is deliberate (so Q4
  does not confound with Q1) and it makes the pullback arms look slightly worse
  than a maker implementation would.
- **AVAX and SUI's Revolut X minimum order size has never been read.** §2.1's
  probe covered BTC, ETH and SOL. Every legality claim about a $6.67 or $10
  tranche on those two coins is an assumption in this report, flagged as one.
- **The risk gate is not in the backtest**, here as in §3.10 and §3.11: the
  daily loss limit, the order-count cap and the global pause are not simulated.
  They block new risk rather than exits, so they can only make a live row trade
  less than these tables do.
- **The model is not in the backtest.** Jev can only veto entries, so every
  figure is an upper bound on what the live row would have traded.
- **The high-water mark after a mid-bar fill is the bar's own high**, including
  the part of the bar before the resting order filled — inherited from `run`,
  which enters at the open. It slightly over-states the trail's anchor for
  maker entries, in the direction of *more* stopping out, so it does not flatter
  the maker arms.
- **Nothing here re-opens §3.11's recommendation about which row, which coins
  or how much money.** The sleeve, the slots and the caps are taken as given;
  only the four execution choices inside them were varied.

---

## Commands run

```
npx deno check --quiet supabase/functions/agents/backtest_execution.ts
npx deno run --allow-net --allow-read --allow-write \
    supabase/functions/agents/backtest_execution.ts \
    --data <scratchpad>/ohlcv --out docs/agents/backtests
```

Run time **19.0–19.1 s** for 5 coins, 2 windows, 16 execution arms, 9 fill
assumptions, 7 cooldowns, 216 stop surfaces, 12 tranche variants and 16
combinations. The script reads no network; `--allow-net` is in the command line
because the brief names it. `latest.json`, `summary.json`, `allocation.json`,
`portfolio.json` and `kraken.json` were not touched.

**Determinism**: `docs/agents/backtests/execution.json` carries no timestamp,
no `Date.now()` and no random number. The script was run three times over the
same candle files — twice into a scratch directory and once into
`docs/agents/backtests` — and the outputs compared with `cmp`: **byte-for-byte
identical every time**.

## Files written

- `supabase/functions/agents/backtest_execution.ts` — the study script (new).
- `docs/agents/backtests/execution.json` — its raw output, including the
  fidelity block, every parameter grid and every arm (new).
- `docs/agents/reviews/2026-09-21-execution-study.md` — this file (new).

No other repository file was touched; nothing was committed or pushed.
