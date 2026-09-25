# HTDRAW fails its bar (fp5, 2026-09-25)

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-htdraw.md`. Both runs sha256
`92934d7c566683f512e57cf997dadf6598f53989ae5c7dfaedc9a0f30c91c2cb`.

Out of sample **−$28.56 on 20 trades**, 6 won and 14 lost. The first half is −$90.29 on 16.
The second half is +$61.73 on 4. Stress −$32.60. The null's 95th percentile is +$88.66.
The 4% a year on a $30 peak fails. In sample has no trade. Not DRAWBASE.

The input holds 599 contracts, of which 129 are halftime results. HTDRAW filled 20, left 558
with no trade, and 21 under the $2 minimum. One April fill was recomputed with the fee formula
and matched the scorer (−$10.1857): shown 0.38, tick 0.001, a print at 0.38 floored to 0.381,
rate 0.03, payout 0, quantity 10/0.381, fee 0.03 × 0.381 × 0.619.
