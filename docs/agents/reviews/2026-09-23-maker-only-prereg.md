# Pre-registration: maker-only (post-only) rules on Revolut X's majors

Written 2026-09-23 07:05 UTC (`date -u` read 07:04:38Z), BEFORE any candidate
arm was run on real prices. Nothing above the "Corrections" heading is edited
after results exist. Corrections go below it, dated, and are reported.

What had been run when this was written, all of it by
`supabase/functions/agents/backtest_maker.ts` in the scratch worktree
`wt_maker` (detached at origin/main 91afb69):

- `--stage definitions` (log `maker_work/definitions.log`). It runs no
  candidate. It reproduced the incumbent, proved the simulator against `run`,
  ran the fill-rule unit checks and printed the coverage and tick table used
  below.
- `--stage smoke` (logs `maker_work/smoke20*.log`, `smoke1000.log`). The whole
  pipeline on a SEEDED SYNTHETIC random walk laid on the real timestamps. No
  candidate read a real price. It exists to debug code. The one change it
  caused was to the synthetic generator itself (a mean-reverting level so a
  coin's tick stays a realistic share of its synthetic price).

No candidate rule has been evaluated on real data.

## The question

Revolut X charges 0 % maker and 9 bps taker. Every rule this project runs takes
the touch. Binance (the owner's second venue) charges 10 bps either way. Does a
rule whose entries AND exits are post-only resting limit orders become viable on
BTC, ETH and SOL (AVAX secondary), where the taker version of the same kind of
rule was rejected (§3.6)? It pays no fee. Its costs are orders that never fill
and fills that arrive exactly when the market trades through them.

## Venue facts used (sources, not assumptions)

- Fees: 0 % maker, 9 bps taker (reference §2). The half-spreads are `backtest.ts`
  `COSTS.revx`: BTC 0.75, ETH 1.05, SOL 1.55 and AVAX 4.80 bps.
- Ticks (`quote_step`): BTC 0.01, ETH 0.01, SOL 0.001, AVAX 0.001. They come from
  `GET /1.0/public/configuration/pairs` (keyless) as saved in the scratchpad's
  `revx_pairs.json`, and the run throws if they disagree. Over the bars the
  windows use (from each coin's earliest in-sample start: 2020-08-22 for BTC
  and ETH, 2021-06-17 SOL, 2021-12-21 AVAX), one tick is 0.002 bps (BTC),
  0.044 (ETH), 0.101 (SOL) and 0.497 (AVAX) at the median close. At the lowest
  close it is 0.010 / 0.312 / 1.140 / 1.704 bps (definitions log).
- The order cap is 1,000 placements per 24 h (the place-order day bucket).
- UK book volume (set2.json `ukBookUsdPerDay`): BTC $3.6m, ETH $3.2m, SOL $3.3m
  and AVAX $1.9m a day. All four clear §4.15's $100k.

## The incumbent

- `set2.json`'s `equal` row: `trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five
  equal $20 slots. Windows C and D have four slots ($80), because SUI has no
  data there. It uses the seeded parameters and Revolut X's costs. It is rebuilt
  from `backtest_jev.ts`'s exported machinery (`loadMeasuredSeries`,
  `buildTrack`, `trackDecider`, `rulePolicy`, `runGated`, `sleeveStatsOf`).
- Reproduction (done, definitions log): equal to set2.json on all four
  evaluations × four windows, worst |Δ| = 0. Primary: A +8.03 % (DD 11.28 %),
  B +20.08 %, C +55.64 %, D −7.81 %. `runGated` ≡ `run` on 72 cells.
- The question names BTC/ETH/SOL/AVAX, so a four-coin variant (the same runs
  without SUI) is reported beside it in the combination. The deciding
  incumbent is set2.json's row.

## The fill model (primary), exactly

1. A decision is taken at the close of bar i, on data up to bar i. An order it
   places rests during bar i+1 only (life: one bar). An unfilled order is
   cancelled at the close of i+1 and the rule decides again. A re-quote is a
   new order.
2. Order prices sit on Revolut X's tick grid. A bid is floored to the tick and
   capped at the touch bid at placement, open(i+1) × (1 − half-spread),
   floored. An ask is ceiled and floored at the touch ask, open(i+1) ×
   (1 + half-spread), ceiled. A post-only order is therefore never marketable
   and never rejected.
3. A bid at L fills in bar i+1 only if that bar's low ≤ L − 1 tick: traded
   through, not touched. An ask at U fills only if the high ≥ U + 1 tick. Tick
   comparisons use a 1e-9-tick tolerance so an exact one-tick trade-through
   counts. The fill price is the limit and the fee is 0.
4. An exit ask is placed no earlier than the bar after the fill bar. Inside a
   bar, the order of the high and the low is unknown.
5. The protective stops are TAKER exits, priced exactly as `run` prices them:
   min(level, open) × (1 − half-spread), with 9 bps. The shipped stop is the
   8 % floor under cost. The trail stop adds a 3×ATR(14) trail from the
   high-water. Both are read against the FILL bar's own low (the fill is taken
   to come first). On every later bar they are read BEFORE any resting ask:
   when one bar could have filled both, the stop is assumed.
6. The high-water mark starts at the fill price. It then takes the fill bar's
   CLOSE, the only price known to come after the fill, and then each later
   bar's high. The average cost is `applyFill`'s, to the bit.
7. Cooldown: no new entry order for two of the rule's own bars after any exit
   (`reentryBars` = 2, `run`'s arithmetic). An exit filled in bar e allows the
   next bid to rest in bar e+3 at the earliest.
8. Accounting is one slot, all-in / all-out, with equity marked at every bar's
   close. Return, drawdown, exposure and days follow `run`'s formulas. In
   `market` mode the simulator IS `run`: 72/72 cells identical in return,
   drawdown, trades, stops, exposure and days.

Unit checks pinning 1–7 on hand-built bars: 10/10 pass (definitions log).

## Arms on the same fills, and the sensitivities

- MAKER: the primary fill model at 0 % fee. It DECIDES.
- TAKER-COST ("the same rule at taker cost"): the identical fills and exits.
  Every entry and every non-stop exit is repriced at its reference price
  ± half-spread plus 9 bps, exactly as `run` prices a taker fill against its
  reference open. Stops are unchanged. This isolates what the fee and the
  spread are worth. It never decides.
- 10 BPS (Binance's fee either way): the same fills, 10 bps on every fill,
  Revolut X's half-spread on the stops. Descriptive. It asks whether the other
  venue could run the same thing.
- S1: the same run with two ticks through. S2: the same run with the low
  (high) 10 bps through the limit. At these ticks one tick is 0.002–0.5 bps at
  the median close (0.01–1.7 at the lowest), so S1 barely differs from the
  primary. S2 sits in §3.13's 10–20 bps
  adverse-selection break-even band. Both use the chosen parameters,
  re-scored out of sample. Neither decides. A pass that does not survive S2 is
  reported as fragile to the fill model.

## The family: three shapes, each on 1h and 4h bars (six candidates)

- `rsi2` is §3.6's RSI(2) pullback and its published grid, unchanged:
  N {100, 200} × E {5, 10, 20} × X {60, 70, 80} × H {8, 16} = 36 points. RSI(2)
  is `m15/freq_study.py`'s (sums of the last two up and down moves; no down move
  reads 100).
  - Entry: when flat, close > SMA(N) and RSI(2) < E, a bid at the touch,
    re-placed each bar while the signal holds.
  - Exit: armed by RSI(2) > X, or H bars held (fill bar = 1), or close < SMA(N).
    Once armed, an ask at the touch, re-placed each bar until filled.
  - Warm-up N + 1.
- `band` is Bollinger reversion with no trend filter: n {20, 50} ×
  k {1.5, 2.0, 2.5} × H {12, 24} = 12 points.
  - Entry: when flat, a bid at SMA(n) − k·SD(n) (population SD of the last n
    closes), re-placed every bar.
  - Exit: an ask at SMA(n), re-placed every bar. After H bars held, the ask
    goes to the touch.
  - Warm-up n + 1.
- `dip` is a dip-limit in an uptrend: N {50, 200} × a {0.5, 1.0, 1.5} ×
  b {0.5, 1.0, 2.0} = 18 points, with H = 16 fixed.
  - Entry: when flat and close > SMA(N), a bid at close − a·ATR(14),
    re-placed every bar.
  - Exit: an ask at fill + b·ATR(14), using the ATR of the bar the filled order
    was placed on. After 16 bars held, the ask goes to the touch.
  - Warm-up max(N, 15) + 1.

SMA is the rulebook's `sma`, and ATR is its `atrAt`. The candidates are
`rsi2-1h`, `rsi2-4h`, `band-1h`, `band-4h`, `dip-1h` and `dip-4h`. There is
one $20 slot per coin. BTC, ETH and SOL decide. AVAX is secondary: it is run
and reported, it counts in the chance count, and it never decides.

## Windows, tapes, evaluations, walk-forward

- Windows A–D and both tapes come from `backtest_jev.ts` `loadMeasuredSeries`
  (unchanged). The four evaluations are `CONDITIONS`: shipped·coinbase
  (primary), shipped·kraken, trail·coinbase and trail·kraken. `shipped` is the
  8 % floor. `trail` is the floor plus the 3×ATR(14) intra-bar trail
  (`stopsOf`).
- 4h candidates use those arrays exactly. The code asserts that the spans map
  onto `loadMeasuredSeries`'s indices.
- 1h candidates use the hourly series those arrays are built from, mapped by
  timestamp:
  - coinbase tape: Kraken-hourly-before-the-splice + Coinbase hourly. Its
    resample is asserted to be the 4h series.
  - kraken tape: Kraken's hourly quarterly bundle, which ENDS 2026-06-30T23:00Z.
    The coverage rule is `backtest_jev.ts`'s.
  - Hence 1h × kraken prices no window A for any coin, no window D for SOL
    (its hourly tape starts 3 h after D's in-sample start), and no C or D for
    AVAX. A three-coin cell missing a deciding coin is unpriced.
- In-sample arrays start cold at the Coinbase series' first bar for A and B
  (on each tape), as every published table does. C and D use the whole tape.
  Out of sample runs on the full tape.
- Choice: per coin × window × evaluation, the grid point with the best
  in-sample ret / max(0.05, maxDD) (`score`), first in grid order on a tie. It
  is chosen at the maker primary fill. A grid point that never trades scores
  0. That is the standing rule, and it means no edge in sample.
- OOS spans (primary, BTC/ETH/SOL): A 2025-09-10 → 2026-09-20,
  B 2024-08-31 → 2025-09-10, C 2023-08-22 → 2024-08-31,
  D 2022-08-22 → 2023-08-22. AVAX is one month later.

## The null (decides, with the rest of the bar)

Per coin × window × evaluation, the null is drawn at the chosen configuration.

- It takes the arm's number of entries (fills) and its holding times: fill bar
  to exit bar, with a trade still open at the end censored at the end.
- Each draw picks that many distinct decision bars uniformly on
  [start, to − 2] (Floyd's algorithm), sorted, and a random permutation of the
  holding times.
- At each drawn bar (or the first bar after it that is flat and out of
  cooldown), the null places a bid at the touch, re-placed each bar until it
  fills. It holds for the drawn time, then places an ask at the touch,
  re-placed until it fills.
- The fill model, stops and cooldown are the arm's. Entries that fall off the
  window's end are lost (the mean shortfall is reported).
- There are 1,000 draws, seeded `mulberry32(seedOf("maker-null", candidate,
  evaluation, window, coin, draw))`.
- A sleeve's null combines the coins' draw k into sleeve draw k, with
  `combine`'s arithmetic on day-indexed arrays. Code asserts that arithmetic
  equals `combine` on every arm sleeve.
- P(null ≥ arm) is `atLeast` on returns rounded to 4 dp, with ties counted
  against the arm.

## The bar

**A candidate PASSES only if all of the following hold on window A AND on
window B, in EVERY evaluation priced there.** For the 1h candidates that means
A on shipped·coinbase and trail·coinbase, and B on all four. The sleeve tested
is the three-coin sleeve, BTC/ETH/SOL at $20 each, each coin at its own chosen
parameters, maker primary fill.

1. The sleeve's OOS return is > 0.
2. The sleeve's max drawdown is < 35 %.
3. P(sleeve null ≥ sleeve return) ≤ 0.05, i.e. above the null's 95th
   percentile.
4. The plateau is ≥ 50 %: the share of the shape's grid points whose OOS
   sleeve return (all three coins at that point) is > 0.

Per coin, §4.15's form (reported; it feeds the chance count; it never decides
on its own), on the primary evaluation. A coin clears a window if:

- return > 0;
- drawdown < 35 %;
- the coin's plateau is ≥ 50 %;
- P(coin null ≥ coin return) ≤ 0.05.

The last test replaces §4.15's Kraken-cost test, which a 0 %-maker question
cannot use: 40 bps maker is the thing being avoided. The book test passes for
all four coins. A coin "clears the bar" on A and B.

**Chance count** (§3.12): per candidate, units = 4 coins. The expected number
clearing both windows is 4 × (share clearing A) × (share clearing B), summed
over the six candidates, against the observed count.

**Multiple comparisons:** six candidates. The nominal level is 0.05 per
candidate. Bonferroni 0.0083 is reported as context and never decides. Earlier
looks at this family are counted in the context, not in the test: §3.2's
hourly RSI mean-reversion, §3.6's RSI(2) pullback at 15 m / 60 m, and §3.13's
maker-execution arm of the trend rule.

## Combination

- The best candidate is the one with the highest min(A, B) three-coin sleeve
  return, primary evaluation, maker fill. It is chosen whether or not it
  passes. All six are computed and written to the JSON.
- Per window A–D and evaluation, report:
  - the Pearson correlation of the daily sleeve returns (`combine`'s P&L over
    capital) of the candidate and the incumbent, on days both have;
  - the incumbent alone, the candidate alone, and a book of HALF EACH: the
    incumbent's slots halved ($10), and the candidate's three slots sharing
    the other half ($16.67 each in A/B, $13.33 in C/D). Each is given as
    return, drawdown and ret/DD.
- The same is repeated against the four-coin incumbent variant.

## Orders a day

Every placement counts (every resting order each bar, every re-quote and every
taker stop). Cancels do not count. The count is per UTC day, summed over the
sleeve's coins, for three and four coins. Report the maximum for each
candidate and overall, against the 1,000 cap. The incumbent adds at most one
order per coin per 4h bar, at most 30 a day.

## Third tape (descriptive, never decides)

The 4h candidates are run on window A over Revolut X's own UK 4h book (the
scratchpad's `revxuk/`: keyless `/public/candles`, `region=UK`, from
2025-09-11). Kraken's 4h tape is spliced before the book's first bar for
warm-up, as set2.json's third tape. The parameters are the ones chosen on
shipped·kraken's in-sample, under the shipped stop. Report maker and taker-cost
per coin and for the three-coin sleeve, beside the Kraken-tape result with the
same parameters.

## Also reported (descriptive)

- entry and exit fill rates (fills / placements);
- exits by kind (target / touch / stop);
- the move from the entry fill to the fill bar's close, one bar later and four
  bars later (bps; a negative mean is adverse selection);
- the per-coin compounded returns, beside the sleeve's `combine` figure. That
  figure books each slot's daily return on a fixed notional, so it is not
  bounded at −100 % for a heavy-turnover losing arm.

## Reading rules, written now

- If no candidate passes, the answer to the question is no, for these shapes,
  at this fill model. "What the fee is worth" is maker minus taker-cost,
  quoted per window.
- A candidate that passes is "viable in backtest". It is NOT a live
  recommendation. It is quoted with its S2 result and third-tape result, and
  paper and the 0042 maker probes come first.
- A candidate is "Revolut-X-only" only if it passes AND its 10 bps arm is ≤ 0
  on A or B in the primary evaluation.
- A one-window pass is noise (§3.15). It is not partial credit.

## Known limits, written before the numbers

- Bars are not a book. Queue position inside the touch is invisible, and a
  trade-through on Coinbase's or Kraken's tape stands in for one on the UK book.
  The third tape covers window A only.
- A one-bar order life stands in for the loop's minute-by-minute re-quotes.
- There is no latency model, and no partial fills.
- Jev is not in the backtest.
- The daily loss limit is not simulated.

## Determinism and outputs

`backtest_maker.ts --stage full` writes `docs/agents/backtests/maker.json` and
nothing else. It writes no wall clock. `backtest.ts` (sha256 `31d27c7d…`),
`agents_strategy.ts` (`097c9519…`), `backtest_jev.ts` (`4d5af9e5…`) and itself
are hashed at the start and the end, and a run that straddles an edit throws.
Every input file is hashed into the output, including this file. The run is
done twice, and the two sha256s must match.

## Corrections
