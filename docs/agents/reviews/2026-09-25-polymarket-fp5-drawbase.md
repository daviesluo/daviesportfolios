# DRAWBASE fails its bar (fp5, 2026-09-25)

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-drawbase.md`. Both runs sha256
`07df6a9fd911e6a2748f86112a96acef9f08fd67aff6735ef534557d9e8af8c8`.

Out of sample **+$361.59 on 100 trades**, 29 won and 71 lost. The first half is +$415.62 on 90.
The second half is −$54.03 on 10, so the two halves fail. Stress +$344.87. The null's 95th
percentile is +$322.06, which this result beats. January is +$201.31, 56% of the profit;
without it +$160.28 remains, and the month is still over the 40% line. The 4% a year on a
$40 peak passes (+1,304% a year). In sample −$102.84 on 58. Not retried with January or the
second half removed.

One fill was recomputed with the fee formula. Manchester City vs Crystal Palace, 21 March 2026,
the draw. Shown 0.225, tick 0.001, so the floor is 0.226. A NO sell at 0.78 is a YES buy at
0.22, which the floor lifts to 0.226. Shares are 10 / 0.226 = 44.24778761061947. The rate is
0.03, so the fee is 0.03 × 0.226 × 0.774 = 0.00524772. Cash out is
44.24778761061947 × (0.226 + 0.00524772) = 10.2322. The draw lost, so the P&L is −$10.2322.
`pnl_of` matches. January's 19 trades sum to +$201.313801, which is the January figure in the result.

410 events, 158 filled, 239 with no trade, 13 under the $2 minimum. No incomplete tape.
