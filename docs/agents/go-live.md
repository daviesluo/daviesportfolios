# Going live — what would run, what it is expected to do, and what I would not turn on

Written 2026-09-21 for the decision Davies asked for: the final strategy
set, the coins, the mechanics, where the edge is supposed to come from,
and the expected return, with the evidence behind each. Nothing here is
a projection. Every figure is a walk-forward backtest run with the live
loop's own fills, fees, stops and cooldown, or a measurement.

Sources, all in this repository: `reference.md` §3.3a–§3.10 and §4;
`reviews/2026-09-21-portfolio-study.md` (the portfolio study);
`reviews/2026-09-21-prelive-review.md` (the independent code review);
raw output under `backtests/`.

## 1. What runs today, and what live would change

**Three** strategy rows tick every minute, all **paper**, since 2026-09-20
18:23 UTC. Seven ran until 2026-09-22, when §3.17 re-priced the set on
four windows and `0043`/`0044` retired and then deleted three rows that
were 0.90–1.00 correlated with a row that stays and worse in all four
windows (`momentum-1d-kraken`, `rotation-1d`, `rotation-1w-kraken`). The
fourth, `trend-4h-kraken`, was deleted with its history by `0046` the
same day on Davies' word: it made no decision of its own (50 of 50
matched `trend-4h`), and the fill measurement it was kept for had been
taken without it (reference §4.22). Nothing was added: every candidate
§3.15, §3.17 and §4.23 priced is inside chance.

| row | venue | coins | capital | slot | bar |
|---|---|---|---|---|---|
| `trend-4h` | Revolut X | BTC ETH SOL AVAX SUI | $100 | $20 | 4 h |
| `momentum-1d` | Revolut X | BTC ETH SOL | $40 | $13.33 | 1 d |
| `trend-1h` | Revolut X | BTC ETH SOL | $40 | $13.33 | 1 h |

Row capital is $180, down from $440; no cap moved. `trend-1h` is kept
for feedback speed and because at 0.63 it is the only row with no
near-duplicate; its return is inside chance and inside the
spread error bar and is not read as evidence either.

**Live changes exactly one thing**: a row whose `mode` is `live` sends
its order to the venue instead of writing a paper fill. Every rule,
stop, cap and claim is the same code either way. It needs three
switches at once — `agent_strategies.mode = 'live'`,
`agent_risk.live_confirmed_at` set, and the risk gate's allowance — plus
credentials for that venue, and the first live order additionally needs
Davies' word in the conversation.

## 2. How one trade happens, end to end

1. **Every minute** the loop quotes both venues (UK book on Revolut X,
   always), tops up the candle cache from the rule's *signal* venue —
   Kraken, the deeper book — and records the basis every fifth minute.
2. **Every minute** it re-reads open orders, settles what filled, and
   re-quotes a resting order the touch has walked away from (five times
   at most, nothing rests past an hour).
3. **Every minute** it checks protective exits against the live mark: an
   **8 % floor under the position's own cost**, on every rule, and
   nothing else: the 3×ATR(14) trail that ran here until 2026-09-21 was
   the rulebook's own trail read on wicks instead of closes, and it took
   48 of 49 protective exits in the bear window (reference §3.13). The
   rulebook still trails by 3×ATR from the high since entry — on the
   close, at the bar boundary. A stop sells without asking the model, and
   cancels a resting exit first if one is in the way.
4. **Every minute** it writes the categorical state of the forming bar
   to `agent_observations` when it changes — that is what the page shows
   as the live state between decisions.
5. **On a newly closed bar** (1 h / 4 h / 1 d) and only then, it builds
   the state, asks Jev on **entries only**, applies the rulebook, applies
   the risk gate, claims the bar by inserting the decision, and places
   the order: **marketable at the touch on Revolut X** (9 bps taker — the
   fill every backtest assumes), post-only at the touch on Kraken.
6. After any exit the rule waits **two of its own bars** before buying
   again.

The rulebooks themselves:

- **trend-4h / trend-1h** — enter when the 20-bar average is above the
  100-bar, the close breaks the prior 55-bar high, 30-day momentum is not
  negative and volatility is not extreme; exit on a trend cross-down, a
  close below the prior 20-bar low, or the ATR trail.
- **momentum-1d** — long while today's close is above its close 30 days
  ago, flat otherwise.
- **rotation-1d** — rank BTC/ETH/SOL/XRP by 30-day return, hold the top
  two equal-weighted, and only those above their 100-day average.

**Jev's job.** TypeSafe Jev 1.13 is a decision node, never the source of
the edge. Code computes every number; Jev sees ten categorical words
(trend, breakout, volatility, momentum, position, drawdown…) and answers
two typed questions with probabilities. It can **veto an entry** and
nothing else — it cannot open a position the rule would not, and it is
never asked on an exit. No answer means no entry. Cost is about
$0.0000184 a call.

## 3. Where the edge is supposed to come from, and what the evidence says

The claim is narrow: **long-only trend following on a slow bar, on
liquid crypto pairs, at a fee low enough that 10–40 round trips a year
do not eat it.** Nothing faster survived. Testing showed 15-minute and
1-hour mean-reversion rules lose on every coin because ~300 round trips
a year at 20 bps is 60 % of the account (§3.6); breakout-with-volume,
squeeze breakouts, double bottoms, a bare Donchian, a 4-hour pullback, a
stale-trend exit and weekly bars were all tested and rejected with
numbers (§3.5, §3.9).

**The honest verdict from the portfolio study: of the 21 shipped
strategy × coin × venue members, not one clears the bar on both
walk-forward windows.** Four clear the bear year (trend-4h on SOL and
AVAX, both venues), thirteen clear the bull year, and the two lists
share nothing. The bar is: positive out of sample on that venue's costs,
drawdown under 35 %, at least half the parameter grid positive out of
sample, positive on the other venue's costs too — on **both** windows.

**CORRECTED 2026-09-22 — that verdict WAS re-run, and it changed.** It
was reached under the duplicated stop (reference §3.13), and this
paragraph used to say the re-run had not happened. It had:
`backtest_tape.ts` §T3 re-priced every coin-window cell under BOTH stop
rules the same day. Under the rule `tick.ts` actually runs, on Revolut X
costs, at the seeded point, with both tapes agreeing:

| coin | windows clearing §4.15 |
|---|---|
| **AVAX** | **A, B, C** |
| SOL | A, C |
| ETH | B, C |
| BTC | B, D |
| SUI | **A only** |

**AVAX is the only coin of the 27 priced that clears BOTH walk-forward
windows.** The old sentence — "not one clears the bar on both" — is the
retired stop rule's answer.

**And it is still not a reason to do anything.** Across the 93
coin-window cells priced under the shipped rule, 26 clear the bar: a
per-window pass rate of **0.280**. Twenty-three coins have both A and B
priced, so chance alone gives 0.280² × 23 = **1.80** coins clearing both,
and P(at least one) is 0.85. **One passer is fewer than chance gives.**

So the correction cuts both ways, and neither direction moves the
recommendation. AVAX is not the doubtful member this brief implied, and
it is not a qualified one either — it is the coin the bar admits in a
draw where the bar was always going to admit about two by luck. The
number the recommendation rests on is still the sleeve's, not any
member's, which is what the last sentence of the old paragraph got
right.

That is the single most important sentence in this document. What the
backtests establish is that this set does not blow up and behaves like a
damped version of the market. What they do **not** establish is an edge
that survived being asked twice.

## 4. Expected return — the two windows, never averaged

Window A is 2025-09 → 2026-09, a bear year. Window B is 2024-09 →
2025-09, a bull year. Parameters are chosen on data before each window
and the window itself is held out. Every figure is net of fees, spreads,
stops and the cooldown.

> **Re-run 2026-09-21** after the duplicated intra-bar ATR trail was
> removed (reference §3.13, §4.11). Every figure in this section is the
> re-run; the numbers this brief carried before it are named at the end of
> §4 so the change is on the record. Nothing about the recommendation
> changes — the same plan wins on the worse window — and every number is
> better.

**The whole set, on its $400:**

| | window A (bear) | window B (bull) |
|---|---|---|
| P&L | −$2.38 | +$166.38 |
| return | −0.6 % | +41.6 % |
| max drawdown | 24 % | 11 % |
| return / drawdown | −0.03 | 3.65 |
| Revolut X rows only ($220) | +0.5 % (DD 21 %) | +45.7 % (DD 10 %) |
| Kraken rows only ($180) | −1.9 % (DD 27 %) | +36.6 % (DD 13 %) |
| holding BTC/ETH/SOL/XRP equally | **−46.7 %** | **+178.1 %** |

**The `trend-4h` sleeve on Revolut X alone ($100, five $20 slots)** — the
set I recommend below:

| coin | A: return / DD / trades | B: return / DD / trades |
|---|---|---|
| BTC | −10.7 % / 19 % / 28 | +12.4 % / 17 % / 36 |
| ETH | −8.0 % / 20 % / 22 | +80.1 % / 19 % / 20 |
| SOL | +17.6 % / 23 % / 14 | +3.0 % / 29 % / 29 |
| AVAX | +34.1 % / 9 % / 9 | +6.8 % / 25 % / 20 |
| SUI | +1.4 % / 29 % / 12 | −2.5 % / 31 % / 10 |
| **sleeve as one book, $100** | **+$8.03 (+8.0 %), DD 11.3 %** | **+$20.08 (+20.1 %), DD 10.5 %** |

**Two more windows exist now** (reference §3.15, built from Kraken's own
quarterly history spliced strictly before the Coinbase series, so A and B
keep the exact candles above — verified at 0 / 0 / 0 across 100 cells):

| window | what the market did | sleeve, Coinbase tape | sleeve, **Kraken tape** (what the loop reads) |
|---|---|---|---|
| C | **+243 %**, a stronger bull | **+55.6 %**, DD 7.3 % | +50.9 %, DD 7.7 % |
| B | +72 %, bull | +20.1 %, DD 10.5 % | **+22.5 %**, DD 10.0 % |
| A | −39 %, bear | +8.0 %, DD 11.3 % | **+9.2 %**, DD 10.9 % |
| **D** | **−6 %, sideways** | **−7.8 %**, DD **15.5 %** | **−7.8 %, identical** |

Both tapes are shown because `signal_venue` is `kraken`: the loop decides
on Kraken's candles and executes on Revolut X, while every other table in
this brief is priced on Coinbase's (reference §3.14, §3.16). At sleeve
level the choice is worth about a point and does not change the
recommendation — and window D, the one that decides the ranking, is the
same bars on both. **Per coin it is worth up to thirty points**: AVAX's
bear year is +34.1 % on one tape and +12.6 % on the other, SUI's +1.4 %
against +29.1 %. Decide at sleeve level; do not read a single coin's
figure as if it were stable.

**The paper rows around it changed on 2026-09-22** (reference §3.17, migration `0043`): `momentum-1d-kraken`, `rotation-1d` and `rotation-1w-kraken` are retired — correlated 0.90–1.00 with a row that stays, worse in all four windows, and two of them over the 35 % drawdown limit in the bear year — and `trend-1h` is KEPT, reversing §3.14, because on four windows it is positive in all of them and is the best row in the sideways year. Row capital falls $440 → $280 and no cap moves. Nothing was added: every candidate priced is inside chance.

**Every one of those choices was re-asked on 2026-09-22** (reference §3.19) with four windows, both tapes and — for the bear year — Revolut X's own book, and **none of them moves**: 98 arms, 15 pass the worst-window test, 49 expected by chance once the arms' correlation is measured rather than assumed. The margins are in §3.19; the one worth carrying here is that **no candidate coin is admitted by the bar at all**, and that equal slots is beaten by nothing in the bear year on any of the three tapes.

**Read window D before you decide anything.** The sideways year is the
only one of four this rule loses money in, and it carries the largest
drawdown of the four. That is what a trend rule does when the market goes
nowhere: it is whipsawed in and out. The bear year it survives is a
*trending* bear — the rule was in cash for most of it. So the honest
shape of the expectation is not "flat to good" but **"good when the
market moves, worst when it does not"**, and the only window that
punishes it is the quiet one.

The coins disagree about which window suits them, which is why the sleeve
is steadier than any of its parts: BTC and ETH still lose in the bear
window and carry the bull one, SUI is the only coin negative in the bull
window. **AVAX and SOL are now positive in both** — AVAX +34.1 % / +6.8 %,
SOL +17.6 % / +3.0 % — where under the duplicated stop AVAX read +12.1 %
/ −3.3 %. That does not mean either "clears the bar": the bar is four
tests including a parameter plateau and the other venue's costs, scored
with parameters re-chosen per window, and re-running it is the
third-window study's job, not this brief's. It does mean §3.8's note that
AVAX would not clear the tightened bar was written against a stop that no
longer runs, and that the note was never a mark against AVAX in
particular — the same one-window record was true of BTC, ETH, SOL and
SUI, and AVAX's was simply the one written down, because `0039` added it
the morning the bar tightened.

What the sleeve rests on is still the sleeve's own two numbers and
leave-one-out, not any coin's pass. On leave-one-out AVAX is the most
expensive coin to remove in the bear window: without it the sleeve's
return over drawdown falls by 0.56, the largest of the five; in the bull
window removing it would gain 0.13, and removing SOL 0.59. No removal
helps both windows, so nothing is removed. The sleeve line is from the allocation study (§3.11),
which simulates the five slots as ONE book on one calendar; the per-coin rows above are each split on their own bar
count rather than on the sleeve's, so they do not add to it. The sleeve
figure is the one to read: it is the book this row would have run.

So the honest expectation for a live `trend-4h` sleeve is: **roughly
+8 % in a bad year and +20 % in a good one, on $100 of row capital, with
the sleeve's own drawdown near 11 %** — deployed only 9–14 % of the time,
so most of the year it is cash. That is a real improvement on what this
brief said a day earlier (flat to slightly negative, +10 % in a good
year), and it comes entirely from removing one duplicated stop, not from
a new edge. The sample is still far too small to call it an edge rather
than a draw: 9–36 trades a coin a window, two windows, one of each
regime.

**What the other rulebooks look like** (Revolut X, out of sample):

- `momentum-1d`: A — BTC −17.0 %, ETH +10.4 %, SOL −29.2 %, drawdowns
  33–56 %. B — +38.7 %, +116.0 %, +52.9 %. The largest single winner and
  the largest single loser in the set, with the deepest drawdowns.
- `trend-1h`: A — −14.1 %, +8.2 %, +13.1 % over 58–74 trades. B — −7.3 %,
  +33.0 %, −15.8 %. On a plateau on **no** coin in both windows. Its job
  is feedback speed, not return.
- `rotation-1d`: **every out-of-sample figure is negative**, both venues,
  with and without stops — A −16.2 % on Revolut X costs, −23.6 % on
  Kraken's. It made +237 % in the bull window, which is the same
  statement as "it is long crypto when crypto goes up".

**One finding changed this week**: the backtester had never run the
rotation rows' own stops. With the 8 % floor and the two-day cooldown in,
the rotation rule is **worse** on five variants of six — the floor sells
into a dip a rank rule would have held through, and the cooldown keeps
the slot out of the rebound (§3.4). The stop is not being re-chosen
because of it; that would be fitting. But it is a reason rotation is not
on my live list.

**What §4 said before the 2026-09-21 stop correction**, so the change is
on the record: the whole set −5.4 % / +38.8 % (DD 25 % / 12 %); the
`trend-4h` sleeve −0.3 % (DD 11.8 %) and +12.6 % (DD 10.2 %); per coin in
the bear window BTC −13.6 %, ETH −10.3 %, SOL +13.3 %, AVAX +12.1 %, SUI
−10.5 %, and in the bull window +17.0 %, +49.4 %, −10.9 %, −3.3 %,
+3.0 %; deployment 6.5 % of the bear year; and the expectation "roughly
flat to slightly negative in a bad year, roughly +10 % in a good one".
Every one of those figures included an intra-bar ATR trail that
duplicated the rulebook's own and fired on wicks (§3.13).

## 5. What it costs

| | Revolut X | Kraken |
|---|---|---|
| maker / taker | 0 % / 0.09 % | 0.40 % / 0.80 % |
| how the loop fills | takes the touch (taker) | rests post-only (maker) |
| round trip, majors | ~20 bps | ~82 bps |
| round trip, SUI | ~42 bps | ~84 bps |

At `trend-4h`'s ~49 round trips a year across five coins, fees and
spreads are roughly **2 % of the sleeve a year** on Revolut X. They are
already inside every number in §4. The same sleeve on Kraken pays about
four times that, which is what the Kraken paper twins were kept to
measure — and the study found those twins correlate 0.92–1.00 with their
Revolut X counterparts and earn strictly less in both windows. The last
of them was deleted by `0046`; §4.23 then tested every remaining Kraken
coin and found nothing, so Kraken research stops at this fee tier.

## 6. The risk layer, which the model cannot override

From `agent_risk`, per venue account and per mode:

| cap | value | what it stops |
|---|---|---|
| max order | $20 | any single order |
| max exposure | $100 | open notional, live |
| paper exposure | $300 | the paper twins, measured separately |
| daily loss limit | $5 | **new risk only** — never an exit |
| orders per day | 40 | new risk only |
| global pause | off | everything, both venues |

Plus: an 8 % floor under every position's cost, checked every minute
against the live mark and taken without asking the model — the one thing
that sells between bars. The trend rules also trail by 3×ATR from the
high since entry, but that is the rulebook's own exit, decided on the
close like every other rule exit; a decision claims its bar so two ticks cannot
both order; one tick at a time by lease; a live order is written down
before the venue is called; and a live order whose outcome cannot be
established is **left alone for a person to settle**, never guessed at.

## 7. Recommendation

**Put `trend-4h` on Revolut X live, five coins, five equal $20 slots.
Leave everything else in paper.**

**A second, independent study reached this set from the other
direction** (§3.11, 2026-09-21): asked to find the best allocation
across coins, rows and venues rather than to pick a rulebook, it ranked
thirteen row plans by the WORSE of their two windows and put everything
into this one row. It also answered the two questions that were open:

- **The coins should get equal money.** Weighting them by their own
  recent record loses to equal slots on BOTH windows, because in four
  rows of five the prior period's best coin is the next period's worst.
  Inverse volatility and equal risk each win one window and lose the
  other. Equal slots is not a winner of a search, it is the null that
  nothing beat.
- **Kraken should run no real money.** A round trip there costs 80–96
  bps against Revolut X's 19.5–53.5 and is paid back after ~9.7 days at
  a 30 %-a-year drift, where a Revolut X major takes 2.4; these rules
  hold 0.6–3.4 days. Its twins are 0.905–1.000 correlated with the
  Revolut X rows and worse by 3.0–16.8 points a window. Kraken keeps the
  job it is actually good at, which is supplying the candles every rule
  reads.

Why that row and nothing else:

- It is the rulebook with the most evidence behind it and the tightest
  drawdowns, and the only one with members clearing the bar in each
  window. After the 2026-09-21 stop correction it is also the only row
  whose sleeve is positive in BOTH windows.
- Its trade count (10–40 a year per coin) is the only frequency in the
  set that a 20 bps round trip clearly survives.
- The Revolut X sub-account holds USD, so nothing has to be converted
  first; it has the UK book the loop reads, and costs a quarter of what
  Kraken costs.
- It is capped at five $20 slots, so $100 of exposure at most, and
  the per-order cap makes every slot the same size.

Why not the others, in one line each: **rotation** is negative out of
sample on both venues, breaks the 35 % drawdown limit in the bull year
(41.3 % and 42.8 %) and is made worse by its own stops; **momentum-1d**
is the biggest bull-year contributor and carries a 41 % row drawdown in
the bear year, so it is the first row to add later and the worst one to
add now; **trend-1h** is on a plateau on no coin in either window, and
its feedback-speed case does not survive the numbers — 17–21 fills a
month against trend-4h's 8–11, a factor of two, and trend-4h alone
reaches ten fills in 27–38 days; **every Kraken row** is beaten by its
Revolut X twin on both windows and is blocked anyway until the account
holds USD and the key has a nonce window.

**One number worth sitting with before you decide.** In the bear year
this row is in the market **8.8 % of the time** (14.4 % in the bull).
Most of what it does is stay in cash, and the +8.0 % is earned in those
few weeks — which cuts both ways: it is a small number of trades
carrying the whole result.

**Both Kraken prerequisites are now done** — the account holds USD and
the key has a nonce window — **and the answer did not change.** Asked
again with Kraken able to trade (§3.12), seven rulebooks from four hours
to weekly bars over 27 coins produced 12 two-window passes where chance
alone gives 14.6; Revolut X beat Kraken in 18 of 18 paired comparisons on
both windows; the fee tier needs 15.6× the turnover the account can
generate; and of the eight coins that clear on Kraken while failing
Revolut X's UK book, none clears the bar on both windows. The USD and the
nonce window removed the two reasons Kraken could not trade and left the
one reason it should not, which is 80 bps.

**A more cautious variant**, if preferred: the same row with
`max_exposure_usd` at $40 for the first week — two slots — so the first
live round trip verifies the settlement path with about $0.04 of fees at
risk. The first live order is also what verifies Revolut X's settlement
field names, which the venue's documentation never specified and the
code currently assumes (§4.17, B4); a filled order whose reply lacks
them is now refused rather than recorded as a fill at zero fee.

## 8. What can still go wrong

- **The edge may not exist.** No member clears both windows. Live is a
  test of the plumbing and of the rule in the market it actually meets.
- **The sample is small.** 10–40 trades a coin a window; nothing under
  ~20 round trips separates a rule from luck.
- **Both windows are single draws** — one bear year, one bull year — and
  they disagree about almost every member.
- **The coins move together.** Five long-only crypto trend sleeves are
  closer to one bet than to five.
- **Spreads are one twenty-minute snapshot.** A stressed book is wider
  than the numbers assume. The thin-book guard is built now (2026-09-22):
  an ENTRY is refused when the book is wider than 50 bps and a long's stop
  is judged at the BID rather than the mid — but an EXIT is never refused
  by it, so a trail stop still sells into whatever bid is there. That is
  deliberate: a position that cannot get out is the worse failure.
- **The first live order is the first test of the live settlement
  path.** Paper has never exercised it.

## 9. Pre-live verification — 2026-09-22

Run against production before any mode flip. Four rows, all paper,
`live_confirmed_at` null, nothing live.

### 9.1 What was checked, and what it said

| # | Check | Result |
|---|---|---|
| 1 | Minute cron | **1,440 / 1,440** runs in 24 h, no gaps, no failures |
| 2 | HTTP replies (6 h retained) | **every one a 200**; 360 ticks, zero non-200 |
| 3 | Decisions, 24 h | 137; **0** with `provider: none` — Jev answered every one; **0** refused by the risk gate |
| 4 | Agent errors, 48 h | 3, each a single occurrence, each understood; **none in the last 11 h** |
| 5 | AVAX / SUI end to end | decided every bar; "no close above prior 55-bar high" — the rule has not fired, nothing is broken |
| 6 | Pair config, all five coins | `active`; `min_order_size_quote` **$0.10** — a $20 slot is 200× the floor |
| 7 | Price / size steps | already honoured in code; worst rounding residue $0.0005 (BTC) |
| 8 | Live UK book, same minute | BTC 1.6 · ETH 3.2 · SOL 4.2 · AVAX 9.1 · **SUI 25.7** bps — all inside the 50 bps refusal |
| 9 | Region filter | one row per symbol, UK only — the EEA book cannot leak in |
| 10 | Draft migration | dry-run inside a transaction that rolls itself back: 4 → 5 rows, caps as intended, production untouched |
| 11 | Signed venue path | **VERIFIED 14:05 UTC** — Revolut X, Kraken and Jev all green; see 9.4 |

The three errors: a network timeout at 02:17 that the next minute
healed; a Kraken altname cache still cold for AVAX the minute `0039`
added it; one Kraken ETH candle timeout. All self-healing.

### 9.2 The defect this found

**A position did not carry the mode it was opened in.** The book was
keyed on `strategy_id|symbol` alone, so a row flipped from paper to live
inherited its paper positions — and `trend-4h` is long BTC, ETH and SOL
on paper. The live row would have read itself already long, never bought
them for real, and the first exit or floor stop would have placed a
**real sell at Revolut X for base the account never bought**. Fixed the
same day: the mode is part of the key, one resolver hands both the
position and the fill history to the row's current book, and a paused row
keeps `0043`'s behaviour so it does not lose its exits again. Three pins
and a counterfactual. Reference §4.19.

### 9.3 Two cap facts worth knowing before the switch

- **The exposure cap is marked to market, not costed.** At
  `max_exposure_usd` $100 against a $100 row, four slots up 6 % refuse
  the fifth entry — the cap tightens when the rulebook is working. The
  draft raises it to $150, which cannot loosen risk: the rulebook does
  not pyramid, so five coins at a $20 per-order cap deploy at most $100
  of capital whatever the number says.
- **`daily_loss_limit_usd` is $5 on a $100 book** — 5 %, counting
  realised plus the change in unrealised since the day's open. It blocks
  new entries for the rest of the day and never an exit. Roughly three
  slots stopping out at the 8 % floor reaches it.

### 9.4 The probe — run 2026-09-22 14:05 UTC, green

Fired through `pg_net` from inside Postgres, the way the 2026-09-21 probe
was, so the operator secret goes from the vault straight into the header
and never leaves the database. Read-only; it places nothing.

**Revolut X — the signed path works end to end.**

| call | result |
|---|---|
| private key | loads, form `pkcs8-b64` |
| `GET /1.0/balances` | **200**, one sub-account row |
| `GET /1.0/configuration/pairs` (signed) | **200**, 393 pairs — **all five coins present and `active`**, `min_order_size_quote` $0.10, steps as the public endpoint reports them |
| `GET /1.0/candles/{sym}?…` (signed **with a query string**) | **200**, 5 bars — the signing path most likely to be wrong, and it is right |
| `GET /1.0/orders/active` | **200**, count 0 |
| region | `UK` requested, **5 ticker rows, one per symbol** — the filter is honoured |

The signed pair list is 393 against the public endpoint's 455: the
account's tradable subset, and it contains everything the row needs.

**Kraken — green, and both prerequisites confirmed at the venue.**

| call | result |
|---|---|
| secret | decodes to 64 bytes |
| `Balance` / `BalanceEx` | **200** — the account holds **USD, and no GBP**: the conversion is done |
| `TradeVolume` | **200** — **0.80 % taker / 0.40 % maker**, 30-day volume $0.00, next tier at $2,500 volume (maker 0.30 %). The venue confirms §3.12's fee arithmetic |
| `OHLC` | **200**, 721 rows = the 720-bar ceiling plus the forming bar |
| `OpenOrders` / `ClosedOrders` | **200**, both empty |
| `AddOrder validate=true` | **200**, `txid: null`, the order echoed back — the whole placement path verified without placing anything |

**Jev — both transports answer and agree.** OpenRouter
(`typesafe/jev-1.13-20260917`) and TypeSafe direct (`jev-1.13.0`), both
keys present, no errors, 463 ms and 662 ms, ~$0.0000184 a call. On the
same state they returned calm 0.97 / 0.98, caution 0.08 / 0.08, positive
0.98 / 0.99 — the fallback is real, not decorative.

**The one thing a probe cannot verify, and it is B4.** Both order
histories are EMPTY, so `activeOrders.fields` and `closedOrders.fields`
both came back `[]`. The settlement field names the client reads —
`filled_size`, `average_fill_price`, `fees` on Revolut X, and whether
Kraken returns the client order id — are still the client's assumption.
**The first live order's read-back is what verifies them**, and a filled
order missing them is refused rather than recorded at fee zero. Nothing
short of a real order closes this.

### 9.6 Jev vetoes one entry in five, and no backtest prices that

**Priced since (reference §4.21, 2026-09-22):** on the real model's answers to every entry state, letting it veto takes window A from +8.0 % to −1.0 % and D from −7.8 % to −2.3 %, and a random veto of the same size does as well on the worst window in 30–43 % of draws — it does not pass the bar. The recommendation is to run it in shadow (`params.jevGate: false`) on the live row and on `trend-4h`, its paper control; the §9.5 draft gets that parameter once Davies chooses. The measurement below is the record that started the question.

**Every published number in this document is for the RULEBOOK. The
account runs the rulebook AND Jev.** `combineDecision` turns an entry
into a hold when `P(healthy) < enterMin` (0.6), when caution is extreme,
or when the model does not answer. No backtest models any of it — the
reference says so and is right to — but until 2026-09-22 nobody had
counted it in the live record either, and §9.1's "0 refused by the risk
gate" is true and was materially incomplete: the risk gate is not the
layer that has been refusing things.

The whole record, `agent_decisions`, every row since 2026-09-20:

| | rule said enter | taken | **vetoed by Jev** |
|---|---|---|---|
| `trend-1h` | 5 | 3 | **2** |
| `momentum-1d` | 4 | 3 | **1** |
| `trend-4h` (the live candidate) | 3 | 3 | **0** |
| `trend-4h-kraken` | 3 | 3 | 0 |
| **total** | **15** | **12** | **3 — 20 %** |

Two things about those three matter more than the rate:

- **Two of the three were P(healthy) = 0.59 against a threshold of
  0.60.** Both were SOL on `trend-1h`, on consecutive days. The
  parameter turning them away is a seeded one that has never been
  varied, never been backtested, and gates every entry the live row will
  make. The third was P = 0.15 (BTC, `momentum-1d`) — that one is not a
  knife edge.
- **The live candidate has not been vetoed yet**, 0 of 3. That is three
  entries, which is not evidence of anything; the rate that will apply
  to it is the 20 % measured across the set, not the 0 % measured on
  three bars.

**What this means for the expected return.** If the veto rate holds, the
live row takes roughly four entries in five that the backtests assume,
and which four is decided by a model no study has priced. That is not an
argument against going live — Jev is in the design on purpose, as a veto
that can only ever make the row do LESS — but it is a gap between every
number in §4 and what the account will actually earn, and it should be
read as one. The cheapest way to close it is time: the same query run
again in a month, over a live row's own bars.

### 9.5 The order of operations

1. ~~Run the probe.~~ **Done 14:05 UTC, green — §9.4.**
2. Move `docs/agents/0047_go_live.sql.draft` to
   `supabase/migrations/0047_go_live.sql` and push — check first that
   0047 is still the next free number (`ls supabase/migrations/`; `0045`
   and `0046` are taken and applied, and a file under a used number is
   skipped by `supabase db push`, not applied). **That push is the
   act of going live** — `migrations.yml` applies it.
3. The first live order still needs Davies' word in the conversation.
4. Watch the first fill's read-back: it is what verifies
   `filled_size`, `average_fill_price` and `fees`, which the venue's
   documentation never specified and the client currently assumes. A
   filled order missing them is refused, not recorded at fee zero.

**To stop the buying**: `update public.agent_risk set
live_confirmed_at = null where id = 1;` — one statement, both venues,
every live entry, and **the exits stay armed**. Reach for that before
anything else.

That sentence used to say "every live order", and it was false in the
way that matters: the check was side-agnostic, so clearing the
confirmation refused the protective sell too — real coins with no way
out, once a minute, while the record said the exit was allowed. Found
and fixed 2026-09-22, and pinned. Setting a row to `mode = 'paper'` is
NOT an undo either; it was listed as one until the same day, when
reading the label literally made the row flat and its real coins lost
their exits. A position now resolves to the book that holds it, so real
coins outrank the label.

**To stop absolutely everything, exits included**: `global_pause`. That
one is deliberate — it is a person saying stop, and unwinding the book
by hand is then the intended path.
