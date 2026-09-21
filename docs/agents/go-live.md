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

Seven strategy rows tick every minute, all **paper**, since 2026-09-20
18:23 UTC. In the first 22 hours they made 137 decisions and 18 paper
fills, with no errors and no missed cron runs.

| row | venue | coins | capital | slot | bar |
|---|---|---|---|---|---|
| `trend-4h` | Revolut X | BTC ETH SOL AVAX SUI | $100 | $20 | 4 h |
| `trend-1h` | Revolut X | BTC ETH SOL | $40 | $13.33 | 1 h |
| `momentum-1d` | Revolut X | BTC ETH SOL | $40 | $13.33 | 1 d |
| `rotation-1d` | Revolut X | BTC ETH SOL XRP | $60 | $20 (top 2) | 1 d |
| `trend-4h-kraken` | Kraken | BTC ETH SOL AVAX SUI | $100 | $20 | 4 h |
| `momentum-1d-kraken` | Kraken | BTC ETH SOL | $40 | $13.33 | 1 d |
| `rotation-1w-kraken` | Kraken | BTC ETH SOL XRP | $60 | $20 (top 2) | 1 d |

Row capital is $440; the most that can ever be at risk is **$400**,
because the $20 per-order cap leaves $20 of each rotation row
undeployable.

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
   **8 % floor under the position's own cost** on every rule, and a
   **3×ATR(14) trailing stop from the high since entry** on the trend
   rules. A stop sells without asking the model, and cancels a resting
   exit first if one is in the way.
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

That is the single most important sentence in this document. What the
backtests establish is that this set does not blow up and behaves like a
damped version of the market. What they do **not** establish is an edge
that survived being asked twice.

## 4. Expected return — the two windows, never averaged

Window A is 2025-09 → 2026-09, a bear year. Window B is 2024-09 →
2025-09, a bull year. Parameters are chosen on data before each window
and the window itself is held out. Every figure is net of fees, spreads,
stops and the cooldown.

**The whole set, on its $400:**

| | window A (bear) | window B (bull) |
|---|---|---|
| P&L | −$21.54 | +$155.21 |
| return | −5.4 % | +38.8 % |
| max drawdown | 25 % | 12 % |
| return / drawdown | −0.22 | 3.19 |
| Revolut X rows only ($220) | −3.5 % (DD 22 %) | +43.5 % (DD 11 %) |
| Kraken rows only ($180) | −7.6 % (DD 29 %) | +33.0 % (DD 14 %) |
| holding BTC/ETH/SOL/XRP equally | **−46.7 %** | **+178.1 %** |

**The `trend-4h` sleeve on Revolut X alone ($100, five $20 slots)** — the
set I recommend below:

| coin | A: return / DD / trades | B: return / DD / trades |
|---|---|---|
| BTC | −13.6 % / 21 % / 32 | +17.0 % / 15 % / 40 |
| ETH | −10.3 % / 20 % / 24 | +49.4 % / 22 % / 28 |
| SOL | +13.3 % / 18 % / 16 | −10.9 % / 37 % / 35 |
| AVAX | +12.1 % / 9 % / 10 | −3.3 % / 24 % / 24 |
| SUI | −10.5 % / 25 % / 16 | +3.0 % / 26 % / 10 |
| **sleeve as one book, $100** | **−$0.33 (−0.3 %), DD 11.8 %** | **+$12.64 (+12.6 %), DD 10.2 %** |

Each coin clears the bar in exactly one window and fails the other, and
they disagree about which — which is why the sleeve is steadier than any
of its parts. **Every one of the five, AVAX included** — so §3.8's note that
AVAX would not clear the tightened bar today is not a mark against AVAX
in particular; the same is true of BTC, ETH, SOL and SUI, and AVAX's
failure is simply the one that got written down, because `0039` added it
the morning the bar tightened. What the sleeve rests on is the sleeve's
own two numbers and leave-one-out, not any coin's pass. On leave-one-out
AVAX is the most expensive coin to remove in the bear window: without it
the sleeve goes from −0.3 % to **−3.9 %** (return / drawdown −0.03 →
−0.28), while the bull window improves from +12.6 % to +15.6 %. It is
one of only two coins — with SOL — that made money in the bear year. The sleeve line is from the allocation study (§3.11),
which simulates the five slots as ONE book on one calendar; adding the
per-coin rows above gives −$1.81 and +$11.05 instead, because each coin
there is split on its own bar count rather than on the sleeve's. The
sleeve figure is the one to read: it is the book this row would have
run.

So the honest expectation for a live `trend-4h` sleeve is: **roughly
flat to slightly negative in a bad year, roughly +10 % in a good one, on
the money deployed, with drawdowns in the 20 % range** — and a sample far
too small to call that an edge rather than a draw.

**What the other rulebooks look like** (Revolut X, out of sample):

- `momentum-1d`: A — BTC −17.0 %, ETH +10.4 %, SOL −29.2 %, drawdowns
  33–56 %. B — +38.7 %, +116.0 %, +52.9 %. The largest single winner and
  the largest single loser in the set, with the deepest drawdowns.
- `trend-1h`: A — −9.3 %, −6.9 %, +14.1 % over 66–78 trades. B — −7.3 %,
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
four times that, which is exactly what the Kraken paper twins exist to
measure — and the study found those twins correlate 0.92–1.00 with their
Revolut X counterparts and earn strictly less in both windows.

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

Plus: an 8 % floor under every position's cost and a 3×ATR trail on the
trend rules, checked every minute against the live mark and taken
without asking the model; a decision claims its bar so two ticks cannot
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
  window.
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
this row is in the market **6.5 % of the time**. Most of what it does is
stay in cash; the −0.3 % is what it costs to be ready.

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
  than the numbers assume, and the thin-book guard is not built yet: a
  trail stop sells into whatever bid is there.
- **The first live order is the first test of the live settlement
  path.** Paper has never exercised it.
