# fp5 — ROUND, a $10,000 strike against the two beside it, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-round-strike.md` (sha256
`e8107a9e21060930bb8f4ff24db26196ede07fbe408453cd2d2eb7803deb33b9`) and frozen in `93bcacc` before any
decision-time price or any return of this rule was computed. The rule is `scripts/round_test.py` (git blob
`8882829ca0cfe73228c1d0ed63449241f55abfc4`, the same blob as that freeze). The input is
`inputs/round_inputs.json.gz` (sha256 `40a147eba1f9949e1e7534977473d59942b497d2c9e175cf85fcefd30620a3d1`).
The run wrote `results/round_run.json` (sha256 `18c83ca54e984cf5412feb7554519077a0d1f5640960a17f2c1c5be072d02b2d`).
A second run of the same command wrote a byte-identical file. `round_test.py --self-check` still prints
`11.36113`.

## What the pull did

369 daily ladders, `endDate` from 2025-01-01 to 2026-09-11. 793 strikes were multiples of $10,000. 143 of
those were an end of the ladder and have no neighbor. 2 had a missing shown price. 234 were inside the
fee and one tick of the line. 77 had a side and less than $2 of fill. 337 filled. No tape hit the page
cap.

## Result

Out of sample (`endDate` 2026-01-01 → 2026-09-11): **−$691.320703 on 245 trades of $10**, cost
$2,248.080989, fees $170.405666, 27 won and 218 lost, −$0.307516 a dollar. OOS1 −$838.27751 on 158.
OOS2 +$146.956808 on 87. Stress (one tick worse, fees doubled, book not re-walked) −$1,132.265293. The
calibration null's mean is −$186.86725 and its 95th percentile +$2,716.626996. Peak capital in the window
$20, −49.87 % a year on that peak over 253 days. The same shares filled at the shown history price, which
nobody could trade, still lose −$373.919727.

In sample, reported and not used to choose anything: −$377.455371 on 92 trades.

Months of the out-of-sample P&L: Jan −243.49, Feb −298.08, Mar +19.52, Apr −352.44, May +36.21, Jun
−104.32, Jul −159.70, Aug −76.84, Sep +487.82. September is the only large positive month. The total is
negative, so the month condition fails on the sign, and dropping September makes the loss larger
(−$1,179.14). Buying YES lost −$99.943769 on 122 trades. Buying NO lost −$591.376933 on 123. That split
was read after the run. It is not a second rule, and neither side is positive.

The bar is the six conditions in the pre-registration. Only the trade count passes. **ROUND fails.**

## What this kills

The straight line through the two adjacent strikes is not a price to take on this ladder, at a multiple
of $10,000, after the crypto taker fee and one tick. Not retried inside this search: a $2,000 or $5,000
modulus, YES only, NO only, a curve instead of a line, or September removed. VOL already killed the
volatility digital on this same ladder. This was the relative-price question, and it fails too.

## Killed on arithmetic before this test, same round

* Buying the UP side of a daily crypto up/down because the coin drifts. The fee at 50¢ is 1.75¢. The
  funding note in the VOL study already put one unit of annual drift at about 0.04 on a 16-hour digital.
  A day of ordinary drift is smaller than the fee.
* An equity "hit this week" digital. M6's near-dated ladder gaps were 0.02¢ a share, and a zero-drift
  digital is the family VOL already failed.
