# fp5 — FADE, a six-hour move taken the other way, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-fade.md` (sha256
`340d6e2794b33a14c1b2e4a4b152f81ead933856687fe73bc5d56aba384614c2`) and frozen in `3fc4a23` before any
decision-time price or any return of this rule was computed. The rule is `scripts/fade_test.py` (git blob
`913645e702487ed49169cd9395fdd521f969a1fb`, the same blob as that freeze). The input is
`inputs/fade_inputs.json.gz` (sha256 `d71aa476a8f66c4914b904430b330e127b0e5c27539123b7a855eb766c63fda0`).
The run wrote `results/fade_run.json` (sha256 `382cf28ae7e537150179008c4f49ce85ae0d1daff4e9db7fe2d56b87e3f4a264`).
A second run of the same command wrote a byte-identical file. `fade_test.py --self-check` still prints
`13.977244`.

## What the pull did

369 daily ladders, `endDate` from 2025-01-01 to 2026-09-11. 108 had a shown price inside 0.40 to 0.60.
Every one of those had an earlier price. 6 did not move by more than the fee and one tick. 3 had a side
and less than $2 of fill. 99 filled. No tape hit the page cap. 261 ladders had no strike in the band.

## Result

Out of sample (`endDate` 2026-01-01 → 2026-09-11): **+$54.579594 on 62 trades of $10**, cost
$617.137661, fees $25.571918, 34 won and 28 lost, +$0.08844 a dollar. OOS1 +$83.214045 on 39. OOS2
−$28.634451 on 23. Stress (one tick worse, fees doubled, book not re-walked) +$27.726773. The
calibration null's mean is −$25.181411 and its 95th percentile +$109.336363. Peak capital in the window
$10, +7.87 % a year on that peak over 253 days. The same shares marked at the shown history price, which
nobody could trade, read +$66.276861.

In sample, reported and not used to choose anything: +$44.468786 on 37 trades.

Months of the out-of-sample P&L: Jan +11.44, Feb +4.91, Mar +48.03, Apr +16.48, May +2.35, Jun −40.44,
Jul +31.39, Aug −9.21, Sep −10.38. March is 88 % of the total. The total without March is +$6.55, so the
month condition fails on the 40 % cap. Dropping March was not done. Buying YES made +$4.806264 on 41
trades. Buying NO made +$49.77333 on 21. That split was read after the run. It is not a second rule.

One fill, checked by hand against the tape: 1 January, NO, shown YES 0.47 against an earlier 0.44, tick
0.001, so the NO floor is 0.531. Two prints at 0.49 fill 6.87755 and 11.954841713747644 shares. Payout 1,
fee rate 0.07: P&L 8.504092, the same figure the scorer returns.

The bar is the six conditions in the pre-registration. Stress and the 4 % on peak capital pass. The two
halves, the null, the trade count and the month do not. **FADE fails.**

## What this kills

A six-hour move in the strike closest to one half, taken the other way, is not a price to take on this
ladder after the crypto taker fee and one tick. Not retried inside this search: following the move
instead of fading it, a different lag, a wider band, March removed, or the same fade on an hourly
up/down. VOL already killed the volatility digital. ROUND already killed the line through the neighbors.
This was the overshoot question, and it fails too.

## Killed on arithmetic before this test, same round

* Buying the UP side of a daily crypto up/down because the coin drifts. The fee at 50¢ is 1.75¢. The
  same arithmetic was recorded with ROUND and is not reopened.
* Fading an hourly, 15-minute, 5-minute or 4-hour crypto up/down. fp4's M3b measured that history lagging
  the prints by about 12¢, and the model lost 2.8¢ a share at the prints. A fade of that history is a
  fade of the lag.
