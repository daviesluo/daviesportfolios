# Fill study — the loop decides on one venue's candles and fills on another's, priced at last

Script `supabase/functions/agents/backtest_fill.ts`; raw output
`docs/agents/backtests/fill.json`. §3.16 named the gap and could not close it:
every `agent_strategies` row has `signal_venue = 'kraken'` and `venue = 'revx'`
(`0037`), so Kraken's 4-hour candles produce the signal and Revolut X's book
produces the fill — and every backtest in this repository, §3.16's own two arms
included, prices signal AND fill on one series. §2c measured the cross-venue
basis at ≤ 3 bps at the touch and called that small against 9 bps of taker fee.
Suggests is not measures. This measures it.

It invents no rule, searches no universe and moves no recommendation on its own.
It changes exactly one thing — which series the fill is priced on — and reports
what moves.

**No wall clock is written into the output.** Two consecutive runs over the same
four data directories produced **byte-identical** `fill.json`
(`md5 dc61d31b3c1a220b6271b16bde276fff`). The run is identified instead by the
SHA-256 of `backtest.ts`, `31d27c7d82f8a94c…`, which is an input to this study
and is the same hash §3.15 and §3.16 recorded.

---

## 0. Two claims in the reference are wrong, and this study rests on it

**§3.16 said Revolut X's tape "needs a signed endpoint and is unreachable from a
harness".** It is not. `GET /1.0/public/candles/{SYM}?interval=240&region=UK` is
public and keyless and was fetched from this harness. The signed call §6 probed
is one way to reach the series, not the only one.

**§2.3 says daily candles reach three years and "hourly is available for the
same span".** The first half is right and the second is not. Paged to the wall on
the UK book, keyless, 2026-09-22:

| interval | bars | span | verdict |
|---|---|---|---|
| daily | 1,114 | 2023-08-19 → 2026-09-21 | three years, as §2.3 says |
| **4-hour** | **2,257** | **2025-09-11 → 2026-09-22** | **376 days, not three years** |
| hourly | — | pages back to the same 2025-09-11 boundary | not three years |

`backtest.ts`'s own header — "Revolut X only serves one year of intraday
history" — was the correct one all along. The contradiction §3.16 left open is
settled, and it did not need a keyed probe.

**`region=UK` is not optional.** Without it the endpoint serves the EEA book
(§2.2), which this account cannot trade, and reading the wrong one is the mistake
that produced the only trade the dislocation rule ever made (§3.5, §4.14). Every
bar here carries `region=UK`; the puller is `scratchpad/pull_revx_uk.py` and the
provenance records endpoint, region, bar count and span per coin.

### What the tape covers, and what it does not

**The real Revolut X tape covers window A and nothing else.** Window A's
out-of-sample span is 2025-09-10 → 2026-09-20; the tape starts 2025-09-11.
Windows B, C and D are older than the venue serves. So:

- **Arm (c) — signal Kraken, fill Revolut X — is a MEASUREMENT on window A**, the
  bear year, and has no entry at all on B, C and D.
- On B, C and D a proxy is all there is. §4 below **calibrates that proxy against
  the truth on window A**, which is worth more than the proxy itself, and the
  answer changes which proxy should be used.

### The three things that could have been papered over, and were not

**1. The one-day shortfall.** Window A's out-of-sample begins 2025-09-10 on
BTC/ETH/SOL and the tape begins 2025-09-11: **374.2 of 375 days, 99.7 %**. The
rule was written before any return was looked at — intersect, require ≥ 180 days
and ≥ 90 % of the window, and price the **clipped span on every arm**, because a
comparison between two calendars is not a comparison. AVAX and SUI need no clip
(their window A begins 2025-09-21).

What the clip costs, measured on the published arm over both spans:

| coin | full span | clipped | Δ |
|---|---|---|---|
| BTC/USD | −10.69 % | −10.69 % | **0.00** |
| ETH/USD | −8.04 % | −8.04 % | **0.00** |
| **SOL/USD** | +17.56 % | +15.15 % | **−2.41** |

One day removes one SOL entry and 2.41 points with it. That is not nothing, and
it is the reason the clipped span is used on *every* arm: it moves all four arms
together and cancels out of every difference reported below. The published
sleeve figure for window A therefore reads +7.62 % here against §3.16's +8.0 %,
and the 0.4-point gap is this clip, not a disagreement.

**2. The gaps in the venue's own tape.** ETC has 1 missing 4-hour bar and TON 2;
every other coin has none. They go through the missing-bar rule, not around it.

**3. The missing-bar rule**, also written down first. The headline policy is
`carry`: a flat synthetic bar at the fill tape's most recent earlier close,
provided it is under three bars old — what an account actually sees, and
conservative, since a flat bar has no high and no low for a stop to reach
through. Beyond that the fill is refused outright: no entry, no exit, no stop
that bar. Every carried bar, refused bar, fill landing on a carried bar and
decision dropped by a refusal is counted.

**What actually happened**, over 48,990 bars on the loop arm:

| arm | bars | exact | carried | refused | fills on a carried bar | decisions refused |
|---|---|---|---|---|---|---|
| **(c) kraken → revx** | 48,990 | 48,989 | **1** | **0** | **0** | **0** |
| proxy kraken → coinbase | 193,287 | 193,259 | 28 | 0 | **0** | **0** |
| (a), (b) | 193,287 / 193,323 | all | 0 | 0 | 0 | 0 |

One carried bar on the whole loop arm, and **no fill and no decision ever landed
on one**. Re-running the live candidate under the strict `skip` policy instead
moves every cell by **0.0000**. The policy could have mattered; on this data it
did not, and that is a measurement rather than an assumption.

---

## 1. Fidelity — four checks, all reported

**1. The one copy, against the original.** `run` takes one candle array and uses
it for both the decision and the fill; that coupling is what this study breaks.
One copy exists, `runSplit`, taken from `run` line by line. It must **be** `run`
when the fill series carries the same bars as the signal series — checked twice
per cell, once with the same array object (which takes an identity fast path) and
once with a **clone**, which does not, so `alignFill` and the entire split path
are exercised and must still land on `run` to the digit.

| compared | cells | worst absolute difference |
|---|---|---|
| return | 2,600 | **0** |
| max drawdown | 2,600 | **0** |
| trade count | 2,600 | **0** |
| days | 2,600 | **0** |
| exposure | 2,600 | **0** |
| fees | 2,600 | **0** |
| **equity curve, point for point (timestamp and value)** | **903,928 points** | **0** |
| curve length mismatches | — | **0** |

**2. The two shared arms against the published study.** Arms (a) and (b) are
§3.16's `kraken` and `coinbase` arms and must reproduce them cell for cell —
chosen parameters, and the return, drawdown and trade count of the chosen and
seeded points, own venue and other venue, every coin × window × venue × stop
rule, against a recorded SHA-256 of `tape.json` (`837dcce62cdfff7d…`, matching
the committed file):

| stop rule | cells compared | cells that differ |
|---|---|---|
| shipped | 2,520 | **0** |
| trail | 2,520 | **0** |

`tape.json`'s own Coinbase arm was checked against `windows.json` at 4,464 cells,
zero differing, so a zero here chains this study back to §3.15 and §3.16. Windows
this study clipped are excluded from the comparison — a clipped span is a
different span — and their cost is the table in §0.

**3. The missing-bar policy**, priced: `carry` against `skip` on the live
candidate, worst |Δreturn| **0.0000** (§0).

**4. The bug this check found, which is the most useful thing in this section.**
The first working version trailed the position's high-water on the **fill** tape.
That is wrong, and the live loop says so: `tick.ts` hands `ruleFor` a position
through `trailed(pos, bars, forming)` and reads its stop level from
`highWaterSince(pos, bars, i)` and `atrAt(bars, i, p.atrN)`, where `bars` is the
**signal** venue's candles. The high-water is an input to a *decision*, not a
price paid. Trailing it on the fill tape moved the rulebook's own close-based
exit and manufactured **a 19-point difference on AVAX in window A** — +31.75 %
against the correct +12.49 % — out of tapes that agree to 4 bps. Corrected, the
three arms fill at the same eight timestamps and differ only by the basis.

It is worth saying plainly what that near-miss was: a plausible-looking split
("signal decides, fill does everything else") would have produced a large, clean,
completely fictitious result. The division the loop actually uses is more mixed,
and `runSplit` documents it line by line:

- **decisions** read the signal tape — indicators, breakouts, daily closes, the bar clock;
- **prices paid** read the fill tape — entry, rule exit, and therefore `avgCost`;
- **the high-water** advances on the **signal** tape, because `tick.ts` does;
- **the protective exit** triggers against the **fill** tape's low, because the loop checks it against the execution venue's live mark;
- **the mark, drawdown and closing equity** read the fill tape — that is what the account is worth.

One consequence is worth flagging because it is a property of the loop and not of
this harness: the protective level is `max(floor, trail)` where the floor is
fill-tape denominated (a fraction under `avgCost`) and the trail is signal-tape
denominated. That comparison mixes two venues' price units. Under the shipped
stop the trail is off and only the floor survives, so the headline is not exposed
to it; under `trail` it is, and that is one more reason `trail` is reported and
not read.

---

## 2. F2 — the three arms, side by side

`trend-4h` · BTC/ETH/SOL/AVAX/SUI · five equal $20 slots · $100 · seeded
parameters · Revolut X costs · shipped stops. **Window A, the only window with a
real Revolut X fill tape**, on the clipped span all arms share:

| arm | signal | fill | return | drawdown | ret/DD |
|---|---|---|---|---|---|
| **(b) published** | Coinbase | Coinbase | +7.62 % | 11.32 % | 0.67 |
| **(a) §3.16's Kraken arm** | Kraken | Kraken | +8.74 % | 10.96 % | 0.80 |
| **(c) WHAT THE LOOP DOES** | **Kraken** | **Revolut X UK** | **+8.69 %** | **11.20 %** | **0.78** |

**The two numbers everyone needs:**

- **(c) − (b) = +1.07 points** (ret/DD +0.11, $+1.07 on $100)
- **(c) − (a) = −0.05 points** (ret/DD −0.02, $−0.05 on $100)

Under the old `trail` stop the same shape, larger: (c) +6.15 % against (b)
−0.75 % and (a) +6.13 % — **(c) − (b) = +6.90, (c) − (a) = +0.02**.

**So the thing that was never modelled is worth five hundredths of a point, and
the thing §3.16 already measured is worth twenty times more.** The fill venue is
not where the error was. Per coin the same holds — arm (c) tracks arm (a) within
0.8 points on every one of the five:

| coin | (b) published | (a) Kraken | **(c) the loop** | (c) − (a) |
|---|---|---|---|---|
| BTC/USD | −10.7 % | −10.1 % | **−10.4 %** | −0.3 |
| ETH/USD | −8.0 % | −6.8 % | **−7.1 %** | −0.3 |
| SOL/USD | +15.2 % | +10.9 % | **+10.6 %** | −0.3 |
| AVAX/USD | +34.1 % | +12.6 % | **+12.5 %** | −0.1 |
| SUI/USD | +1.4 % | +29.1 % | **+29.9 %** | +0.8 |

Windows B, C and D have no arm (c) and are not given one. For the record, on the
arms that can see them (shipped, sleeve return / ret-over-drawdown):

| window | regime | (b) published | (a) Kraken |
|---|---|---|---|
| C | +243 % | +55.6 % / 7.57 | +50.9 % / 6.58 |
| B | +72 % | +20.1 % / 1.92 | +22.5 % / 2.25 |
| A (bear) | −39 % | +7.6 % / 0.67 | +8.7 % / 0.80 |
| D (sideways) | −6 % | −7.8 % / −0.50 | −7.8 % / −0.50 (identical by construction) |

### The proxy, calibrated against the truth — and it changes which proxy to use

Window A is the only place a proxy's error is measurable rather than assumed.
Both candidates were run there beside the real tape (shipped, five-coin sleeve):

| proxy | construction | sleeve error vs truth | per-coin \|error\| median / max | leave-one-out order agrees |
|---|---|---|---|---|
| **fill on Kraken** (= arm (a)) | assume Revolut X's price IS the signal venue's, charge Revolut X's fee and half-spread | **+0.05 pts** (ret/DD +0.02) | 0.29 / **0.78 pts** | **yes** |
| fill on Coinbase | a real independent third venue's tape on the fill side | **−4.93 pts** (ret/DD −0.44) | 0.10 / **28.11 pts** | no |

Over all 23 coins with a window A, not just the sleeve's five: fill-on-Kraken
|error| median 0.77 pts, p95 12.3, max 12.4; fill-on-Coinbase 2.23 / 13.7 /
**28.1**. Under `trail`, sleeve error −0.02 against −4.83.

**The zero-basis proxy is right and the third-venue proxy is wrong**, which is the
opposite of what tape-agreement statistics predict. Bar for bar over the Revolut X
span, Revolut X sits *closer* to Coinbase (median 3.13 bps, p95 20.2) than to
Kraken (4.94, 23.0) on closes. The reason is that closes are not what decides:
**lows are.** A stop fires when the fill venue's low reaches through a level, so
the proxy's error is not a basis at all — it is a foreign venue's wick firing a
stop the real book never fires.

SUI is the whole mechanism in one trade. On 2026-09-19 20:00 all three arms buy
at 0.8756–0.8758. Kraken's and Revolut X's next bars leave the position alone and it is
still open when the window ends. **Coinbase's 2026-09-20 00:00 bar has a low that
reaches through the 8 % floor**, so the proxy sells at 0.8048 and books a loss
where the truth was holding a winner: 13 trades and 1 stop on the real tape, 14
and 2 on the proxy, **+29.9 % against +1.8 %**.

**Consequence, and it is a correction to how this study would otherwise have been
read: windows B, C and D should be read off arm (a), not off the Coinbase-fill
proxy.** Arm (a) is the better estimate of what the loop would have done there — by a
factor of about a hundred **at sleeve level** (0.05 points against 4.93), and by
a more modest 3× on the per-coin median (0.77 against 2.23 points) and 2× on the
per-coin worst (12.4 against 28.1). Both proxies flip one coin's sign out of 23.
So arm (a) is the one to quote for B, C and D, and it is still only good to
about a point per coin. That is also, conveniently, the arm §3.16 already
published.

---

## 3. F3 — the error decomposed, and the basis priced in bps

### The 2 × 2

signal ∈ {Coinbase, Kraken} × fill ∈ {Coinbase, Revolut X}. Main effects are the
average of the two orderings, the interaction is the second difference, and the
three sum to (c) − (b) exactly (`checkSum` in the JSON is that identity
evaluated). Window A, shipped, five-coin sleeve return:

| cell | signal | fill | return |
|---|---|---|---|
| (b) | Coinbase | Coinbase | +7.62 % |
| | Kraken | Coinbase | +3.76 % |
| | Coinbase | Revolut X | +11.95 % |
| **(c)** | **Kraken** | **Revolut X** | **+8.69 %** |

| component | sleeve return | ret/DD |
|---|---|---|
| **total, (c) − (b)** | **+1.07 pts** | +0.11 |
| signal tape | −3.56 | −0.30 |
| fill tape | +4.63 | +0.41 |
| interaction | +0.60 | +0.06 |

Read that carefully, because it is not the clean story it looks like. The
"signal" and "fill" main effects here are each ~4 points and **nearly cancel**,
and both are dominated by the Coinbase-fill cells — the same cells §2 just showed
are contaminated by foreign-venue wicks. The honest reading is the simple
difference, not the decomposition: **holding the signal at Kraken, moving the
fill from Kraken to the real Revolut X book moves the sleeve by 0.05 points**;
moving the signal moves it by 1.12. The 2 × 2 is reported in full in the JSON
because it was asked for and because its interaction term (+0.60, and +4.30 on
AVAX alone) is itself the evidence that the two factors are not separable when
one of the four cells is a different venue's stop-trigger series.

### The basis at every fill — the number this repository has never had

Every fill arm (c) made — entry, rule exit and protective stop — with both
venues' own prices at that timestamp. `basisBps` is (Revolut X's bar open /
Kraken's bar open − 1) × 1e4. `adverseBps` is that basis signed **against** the
trade: positive means Revolut X was the worse place to do it than the signal tape
implied, which is a cost the published backtests do not charge. One stop rule
(`shipped`, what `tick.ts` runs), so no fill is counted twice. **296 fills, 23
coins, 376 days.**

| | value |
|---|---|
| \|basis\| median / p95 / max | **4.53 / 27.5 / 69.2 bps** |
| adverse median / mean | **−0.06 / +0.03 bps** |
| adverse p95 / max / min | +16.0 / +69.2 / −48.5 bps |
| adverse vs favourable fills | 141 / 149, **p = 0.68** |
| **mean adverse cost per round trip** | **0.057 bps** |

**Against the costs that are charged:** a Revolut X round trip is 19.5 bps on
BTC, 20.1 ETH, 21.1 SOL, 27.6 AVAX, 41.9 SUI (9 bps taker plus the measured
half-spread, each side). The unmodelled fill error is **0.057 bps a round trip — 0.29 % of the
cheapest round trip in the book, and 0.32 % of the 18 bps of taker fee inside
it.**
It has no direction (p = 0.68). §2c's ≤ 3 bps at the touch was the right order of
magnitude; this is the same quantity measured over three years of real fills
rather than ten minutes on a Sunday, and it agrees.

Per coin, the five live ones:

| coin | fills | \|basis\| median / p95 | adverse mean | round-trip cost of it | vs the round trip charged |
|---|---|---|---|---|---|
| BTC/USD | 28 | 1.66 / 9.49 | +1.15 | +2.30 bps | 19.5 |
| ETH/USD | 22 | 3.47 / 37.8 | +1.45 | +2.90 | 20.1 |
| SOL/USD | 16 | 2.05 / 16.0 | +1.63 | +3.26 | 21.1 |
| AVAX/USD | 8 | 2.30 / 9.24 | +1.15 | +2.30 | 27.6 |
| SUI/USD | 13 | 4.70 / 28.6 | **−2.22** | −4.44 (a gain) | 41.9 |

Across all 23 coins the per-coin adverse mean runs −5.0 (UNI) to +8.9 (DOT) bps
and straddles zero: 12 coins adverse, 11 favourable.

**The one signed finding, and it is about stops.** Split by what the fill was
for:

| fill kind | n | \|basis\| median | adverse mean | adverse / favourable | p (exact binomial) |
|---|---|---|---|---|---|
| entry | 152 | 4.53 | −1.24 | 64 / 84 | 0.118 |
| rule exit | 121 | 4.18 | +0.62 | 60 / 59 | 1.000 |
| **protective stop** | **23** | **6.22** | **+5.28** | **17 / 6** | **0.035** |

**At the instant a protective stop fires, Revolut X's price is systematically
below Kraken's** — adverse for a sell, by a mean 5.3 bps, 17 times out of 23,
p = 0.035. That is the adverse-selection signature and it is exactly what you
would expect: a stop fires *because* the execution venue's low reached the level,
which selects the instants when that venue is printing low. It is a real cost and
it is not in any published table.

Two honest qualifications on it, because the number is easy to over-read. The
sample is **23 stops**, and at one test among the three reported, p = 0.035
survives no correction worth the name (Šidák over three gives 0.10). And the
executed price of a stop is `min(level, open)` — when the bar does not gap through
the level, both arms fill at the *same* level, so this measures venue
disagreement at stop instants, not per-order slippage on those orders. What the
sleeve arithmetic shows is that whatever it costs, it is inside the 0.05 points
that separate (c) from (a).

### What predicts the fill gap

Spearman rank correlation between the fill gap and seven candidates, over 46
coin × window × stop-rule cells. The list was written before it was run and every
entry is reported:

| predictor | ρ |
|---|---|
| trades | **−0.457** |
| volatility (annualised) | −0.273 |
| UK book $/day | +0.202 |
| half-spread (Revolut X) | −0.198 |
| mean adverse bps | +0.144 |
| \|basis\| median | −0.136 |
| \|basis\| p95 | −0.039 |

**Nothing predicts it, and the basis least of all.** The best is trade count at
−0.46, which is mechanical (more fills, more chances for a stop to land
differently) and is not a statement about prices. That the two basis measures come
last is the same finding as §2's: the disagreement that matters is in the lows,
not in the quoted level.

---

## 4. F4 — does it change any decision?

### §4.15's bar, per coin per window, on arm (c)

23 coins have a window A on the loop arm. Comparing the published verdict with
the loop's:

| stop rule · arm | coin-windows | verdict flips | rate |
|---|---|---|---|
| **shipped · revx · seeded** | 23 | **1** | **4.3 %** |
| shipped · revx · chosen | 23 | 2 | 8.7 % |
| shipped · kraken · seeded | 23 | 1 | 4.3 % |
| trail · revx · seeded | 23 | 4 | 17.4 % |
| trail · kraken · seeded | 23 | 6 | 26.1 % |

**On the shipped stop and the seeded parameters — what `tick.ts` runs — one coin
of 23 moves: ICP/USD, which passes on the published tape and fails on the loop's
for `plateau < 50 %`, on a −4.4-point return difference.** ICP is in no row. Not
one of the five coins in the live row changes verdict.

Under `trail`, four move — DOT, ICP and UNI lose a pass, SUI gains one (+41.3
points). §3.16 measured 5.9 % of coin-windows flipping when the *signal* tape was
swapped, over all its windows; this is 4.3 % on window A with the fill moved as
well. The two rates are not directly comparable — different window populations —
and the flips here are against the published arm, so they carry the signal change
and the fill change together. What separates them is the `krakenArmPasses` column
in the JSON: ICP passes on arm (a) and fails on arm (c), so its flip is the only
one in the shipped seeded arm that the FILL is responsible for.

**No three-window count is possible on arm (c)**, and the JSON says so rather than
inventing one: the Revolut X tape reaches one window, so there is no intersection
to test and the hypergeometric machinery has nothing to run on. That is a limit of
the data, not a null result.

### The five-coin leave-one-out

Positive = the row is better without that coin. Window A, shipped, ret/DD:

| arm | order, most expensive to remove last |
|---|---|
| (b) published | ETH +0.42, BTC +0.40, SOL −0.14, SUI −0.17, **AVAX −0.56** |
| (a) Kraken | ETH +0.49, BTC +0.44, SOL +0.04, AVAX −0.26, **SUI −0.60** |
| **(c) the loop** | **ETH +0.48, BTC +0.44, SOL +0.04, AVAX −0.25, SUI −0.60** |

**Arm (c)'s ordering is arm (a)'s, coin for coin and sign for sign.** The fill
venue changes no member's standing. It differs from the published arm in exactly
the way §3.16 already recorded — the coin most expensive to remove is SUI, not
AVAX — and that is the signal tape's doing, not the fill's. Every member is still
a coin the row is worse without or barely better without; nothing here argues for
removing one.

### Does the recommendation still rank where §3.11 put it?

**Row plans** (§3.11 point 2), restricted to the plans this harness can price —
the rotations need `runRotation`, a basket simulator with no split-fill twin here,
and `trend-1h` needs hourly bars the Revolut X tape is not fetched at. Window A,
shipped, ret/DD:

| plan | (b) published | (a) Kraken | **(c) the loop** |
|---|---|---|---|
| **trend-4h alone ($100)** | **0.67** | **0.80** | **0.78** |
| trend-4h on both venues ($200) | 0.62 | 0.50 | 0.49 |
| trend-4h + momentum-1d ($140) | −0.02 | −0.01 | −0.04 |

**`trend-4h` alone is first on the loop's own arm, as §3.11 put it**, and by a
wider margin than on the published arm.

**Capital per coin** (§3.11 point 1) — and here the honest answer is that arm (c)
*cannot* re-run the test. §3.11's rule is that a plan must beat equal slots on
**both** windows; arm (c) has one. On window A alone, inverse-volatility (0.93)
and concentrate-on-the-best (2.26) both beat equal slots (0.78) on the loop arm —
and that is precisely the one-window evidence §4.15 exists to refuse. On the arms
that can see all four windows the original finding is intact: **nothing beats
equal slots on every window it is priced on.** Inverse-volatility loses B and D;
evidence-weighting loses A and C; concentration loses A, B and C on the published
arm and B and C on Kraken's. Equal slots stays.

**No verdict moves for the live row.** The recommendation — `trend-4h` on
Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots, $100 — reads +8.69 % with
an 11.20 % drawdown in the bear year when priced the way the loop actually
trades, against +7.62 % published.

### The multiple-comparisons control

55,188 parameter-point runs were looked at — one arm being one grid point out of
sample on one coin, one window, one venue's costs, one stop rule and one (signal,
fill) tape pair. **This study searches for nothing.** It re-prices one fixed rule
with the fill moved onto a second tape; the headline is the **seeded** point,
fixed long before this study existed; every window and every stop rule is
reported and never the best of them. There is no best-of-N to correct. Where
counts of passes appear the null is stated exactly and never sampled
(hypergeometric intersection); the sign tests are exact binomials under "the two
tapes are exchangeable at a fill", reported at fill level and at coin level
because fills inside one coin are not independent draws. The one p-value under
0.05 in the whole study (stops, 0.035) is flagged above as not surviving a
correction for the three tests it belongs to.

---

## 5. What this could not settle

- **Three of the four windows have no real fill tape, and never will from this
  source.** Revolut X serves 376 rolling days of 4-hour candles. Windows B, C and
  D are priced on arm (a), which §2 calibrates at 0.05 points of error on the one
  window where truth exists — but that calibration is a single window, in a single
  regime, on 23 coins. A bear year is not a promise about a sideways one.
- **The tape is a rolling window, so the input is not reproducible forever.** The
  output is byte-identical given the same data directory, and the provenance
  records each coin's exact bar count and span; a re-fetch months from now gets a
  different span and different numbers. The puller is
  `scratchpad/pull_revx_uk.py`; to reproduce these figures the directory has to be
  kept, not the command.
- **Bars are not fills.** This prices the fill at a 4-hour bar's open on the
  execution venue's own tape. The live loop takes the touch inside a minute, and
  the gap between a bar's open and the touch a marketable order actually gets is
  what `0042`'s maker probes are recording live. This study replaces one
  assumption (the fill is on the signal venue's tape) with a better one (it is on
  the execution venue's tape); it does not reach the order book.
- **Only `trend-4h` was re-priced**, on seeded and chosen parameters. Not the
  rotations, not `trend-1h`, not the wide variant or the regime gate.
  `momentum-1d` appears only inside the row-plan comparison.
- **23 stops** is the entire sample behind the one directional finding in the
  study.
- **Jev is not in the backtest**, as in every study here.
- **The EEA book was not priced.** Every figure is the UK book. The region-less
  candles that were on disk from 2026-09-20 — the EEA series — were discarded
  unread rather than used, because §4.14 says a price this account cannot get is
  not a price.
