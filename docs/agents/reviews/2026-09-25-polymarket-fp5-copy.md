# fp5 — COPY, five May Bitcoin-ladder wallets, fails its bar

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-copy-wallets.md` (sha256
`170918c7e35e4f38bad2c0a2f97b1873f36c9324b02e0805baed51f40e5b056c`) and frozen in `1113312` before any
wallet was ranked and before any copied return was computed. The rule is `scripts/copy_test.py` (git blob
`a97dac004ddf18da96a476c54d94dccdaf4ccb59`, the same blob as that freeze). The input is
`inputs/copy_inputs.json.gz` (sha256 `215b2b4ea68d7d7ab128eecd0a4aed385dccb515b68724f0282624452fa7e15e`).
The run wrote `results/copy_run.json` (sha256 `35fcffdb5dc18403a0ba7842d249e0f8e9bdab99df7e1a1c6b0fecbf99568f69`).
A second run of the same command wrote a byte-identical file. `copy_test.py --self-check` still prints
`6.701762`.

## What the pull did

The pace changes in `0f800b4` were already on the branch before this run, and they do not change which
rows are kept. This run is that puller. May: 31 events, 38,212 wallets with a taker print, 9,412 with at
least five, no May market incomplete. Closed positions: 8,940 histories read to the end, 472 hit the
40-page cap or a repeated page and were not ranked, as the pre-registration says. The rule then took the
top five by pre-June ladder realised P&L. Their June–September tapes are complete (713 leader buys, 155
markets, no incomplete leader and no incomplete tape). 507 buys had no fill inside five minutes at a
price no better than the leader's. 206 copied.

The five, in rank order, with pre-June ladder realised P&L and closed-position rows: `0x66d75f65…` 
$91,964.42 on 27, `0x7fd3fe65…` $64,850.44 on 41, `0xce244e7b…` $56,808.46 on 26, `0x97bcb187…`
$56,379.96 on 17, `0xafe65d16…` $56,164.81 on 23. The test re-ranked the committed input and got the
same five addresses in the same order.

## Result

Out of sample, leader timestamps 2026-06-01 → 2026-09-11: **+$393.285293 on 206 copied trades**, cost
$915.658854, fees $54.365285, 46 won and 160 lost. OOS1 +$56.929579 on 178. OOS2 +$336.355713 on 28.
Stress (one tick worse, fees doubled, book not re-walked) +$321.490498. The calibration null's mean is
−$53.286212 and its 95th percentile +$395.657642. The result is $2.37 under that percentile. Peak
capital in the window $81.589999, +17.25 % a year on that peak over 102 days.

Months: Jun +5.36, Jul +41.13, Aug +331.08, Sep +15.71. August is 84.2 % of the out-of-sample P&L.
Without it the total is still +$62.20, so the month condition fails on the 40 % cap. August itself is
one wallet: `0xafe65d16…` +$340.35 on 22 trades, and `0x97bcb187…` −$9.27 on 2. That wallet's whole
window is only +$43.56, so the month is not a lasting edge.

Per wallet, out of sample: `0xce244e7b…` +$218.41 on 83, `0x66d75f65…` +$171.60 on 23, `0xafe65d16…`
+$43.56 on 86, `0x97bcb187…` −$18.06 on 9, `0x7fd3fe65…` −$22.22 on 5.

The bar is the six conditions in the pre-registration. Both halves, the stress book, the trade count
and the 4 % a year on peak capital pass. The null and the month do not. **COPY fails.**

## What this kills

Copying the five wallets with the best pre-June realised P&L on this ladder, into later taker buys
filled within five minutes at a price no better than theirs, does not clear the bar. Not retried inside
this search: a longer page cap so the 472 unread histories can enter the ranking, a different top N, a
different lag, copying sells, dropping August, or a different month as the ranking window. The
leaderboard copy was already killed on 2026-09-25 because that ranking has no as-of date. This was the
as-of version, and it fails too. The copy family stops here.
