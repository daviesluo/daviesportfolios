# fp5 — RICH, NO on the dearest post-count bracket, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-rich.md` (sha256
`5f942f45c958a71b159058315bfcf3680cfdf6933e7773070e2f49d28b562d5f`) and frozen in `55f029b` before any
return of this rule was computed. The rule is `scripts/rich_test.py` (git blob
`09788904a7bc2d701c9516819552a7496423060c`). The input is `inputs/rich_inputs.json.gz` (sha256
`6601381ce28e22143ec45ff920203ea6aa5e2cd7381216fadd770a37e2c1e131`). The run wrote `results/rich_run.json`
(sha256 `01a54dfe1b278a6bb11f4f5ad9f27f2e889ae82c493ea61d3e1e9c99d47071cd`). A second run wrote a
byte-identical file. `rich_test.py --self-check` still prints `14.638156`.

## Result

47 events had no trade. 82 filled under $2. 83 filled. No tape was incomplete.

Out of sample: **+$13.973837 on 52 trades**, cost $518.02, fees $3.00, 45 won and 7 lost. OOS1 +$11.20
on 33. OOS2 +$2.77 on 19. Stress +$10.37. The null's mean is −$2.87 and its 95th percentile +$48.65.
Peak capital $50, +40.32 % a year on that peak over 253 days. In sample +$27.81 on 31.

Months by the entry: Dec 2025 +3.77, Jan +6.82, Feb −3.56, Mar −5.01, Apr −1.10, May +12.94, Jun +2.49,
Jul −0.72, Aug −1.65. May is 92.6 % of the total. Without May the remainder is +$1.04.

One fill, the week ending 2 January 2026, bracket 260–279. YES was shown at 0.105, so NO was bought:
10.989011 shares at 0.91, fee rate 0, NO payout 1. P&L 0.989011, which is 10.989011 minus the $10 cost.

Both halves, the stress book and the 4 % on peak capital pass. The null, the trade count and the month
do not. **RICH fails.**

## What this kills

Buying NO on the dearest bracket, while that YES price stays inside 0.10 to 0.90, does not beat a coin
flip at the fill price, and the profit sits in May. Not retried by dropping May, by widening the band
into the favourite entry, or by buying YES on the same bracket.
