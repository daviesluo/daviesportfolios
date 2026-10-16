# BUCKET-DIST: the daily bucket distribution against a driftless lognormal

Research only. No order was sent, no production table was written, and nothing
was armed. The parameters were committed in `ea8f349f` before the print.
They were not changed after this result. Not blind.

## Verdict

**FAIL.**

Headline is T−24 h, threshold 4 probability points, stake $20, seed
20261014, 10,000 draws that resample whole `title_end` days. Sample is
`title_end` 2025-01-01 through 2026-08-31. September is held out.

| bar | figure | pass |
|---|---|---|
| ≥ 150 trades and ≥ 100 markets | 1123 trades, 1123 markets, 323 days | yes |
| mean ROI > 0 and 5% bound > −2% | mean −0.0667, p05 −0.2289, P&L −$1,497.26 | no |
| neighbours the same sign | two of eight match the headline's minus | no |
| no market > 25%, no month > 50% of P&L | top market 1.43%; 2026-08 is 100.9% of net P&L | no |
| each year mean ROI ≥ −5% | 2025 +0.0342 (n 427); 2026 −0.1285 (n 696) | no |

The $50 stake has the same mean, −0.0667, on the same 1123 trades.

Total P&L is negative, so a month's share is that month's P&L divided by the
net. 2026-08 lost $1,510.86 on 86 trades, which is more than the net, so its
share is 1.009. 2025-12 lost $1,150.58 on 100 trades, share 0.77. Both are
over half. The frozen test reports the larger one.

## Neighbours

The headline mean is negative. The same-sign check is the whole cross except
that cell. Every neighbour's 5% bound is also below −2%. That is a reading of
the printed lines, not an extra bar.

| hours | threshold | n | mean ROI | p05 | same sign |
|---|---|---|---|---|---|
| 24 | 0.03 | 1393 | +0.1092 | −0.1434 | no |
| 24 | 0.05 | 921 | −0.1207 | −0.2787 | yes |
| 12 | 0.04 | 1104 | +0.0381 | −0.1312 | no |
| 12 | 0.03 | 1322 | +0.0030 | −0.1474 | no |
| 12 | 0.05 | 922 | +0.0798 | −0.0978 | no |
| 48 | 0.04 | 1501 | +0.0156 | −0.1561 | no |
| 48 | 0.03 | 1875 | −0.0187 | −0.1642 | yes |
| 48 | 0.05 | 1234 | +0.0195 | −0.1533 | no |

## Centre and tail

A side earns when its mean ROI is positive and it has a trade. Centre does
not (−0.0880, n 365). Tail does (+0.0802, n 77). Exactly one side earns.
The five conditions above fail, so the verdict stays FAIL. Had they passed,
the pre-written rule would have named it one-sided rather than PASS.

| cell | n | mean ROI |
|---|---|---|
| centre-bought | 94 | −0.1342 |
| centre-sold | 271 | −0.0720 |
| tail-bought | 46 | +0.1722 |
| tail-sold | 31 | −0.0563 |
| other-bought | 409 | −0.3548 |
| other-sold | 272 | +0.3536 |

Other is in the headline bar and not in the one-sided test. Its bought side
is where the loss sits (−$978 of the −$1,497 is the other role's net).
Choosing the tail, or selling only the other buckets, would be a new
proposal. It is not this result.

## Coverage

Complete Gamma months 2024-01 through 2026-08. 140,926 markets read, 8,013
bucket rows, 774 partitions, 706 with at least 7. No 2024 bucket row. 7,663
rows were pulled. The other 350 are in smaller partitions. Every qualified
row had a Close clause, a matching pair, a fee and a tick.

The print append finished 2026-10-16 22:11 UTC. `trades.done.txt` went from
5,208 lines to 12,871, which is the old tape plus these 7,663. One HTTP 429
was retried. No new market was capped. The one capped id is the earlier
touch market, and it is not a bucket trade. 454 eligible buckets had no
taker-BUY print at T−24 h. Spot was not rewritten: both files still end at
2026-10-04 00:00 UTC, from data-api.binance.vision. The overlap with
api.binance.com was not re-measured.

## September

The September cursor was not sent again. August's complete file is 27,259
rows: above 25,519, buckets 638. The retrieved September slice is 23,562
rows: above 21,846, buckets 660. Both retrieved slices are mostly above, and
buckets are a small share of each. Markets with id after 4946930 were not
retrieved. Their family mix is unknown, so the hole is not described by that
resemblance. None of it is in the headline sample.

## Model

The printed market sum is the sum of the first taker-BUY YES prints at or
after T−24 h. It is not a mid and it was not a filter. Of 706 modelled
partitions, 705 have a model sum within 0.02 of 1. The short one is BTC
2026-01-25, seven buckets, model sum 0.818. It stays in the sample.

Calibration at T−24 h, every modelled eligible bucket, not only trades: the
bottom decile is 5,596 buckets, mean model 0.010 against realised 0.010.
Decile 7 is 33 buckets, model 0.740 against realised 0.485. The table is
`results/s2_verdict.txt`.

## Not checked

Prices-history fills. Touch against terminal. Kalshi. The sports snapshot.
S1 TOUCH-CAL is a separate branch and is not re-litigated here.

## Decision

A FAIL closes this parameter set. A follow-on is a new proposal, not a
re-run. Nothing is armed.
