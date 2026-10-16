# BUCKET-DIST frozen parameters

Frozen in the first commit of `grok/pm-bucket-dist`, before any print request
that can answer the question and before any verdict. SPEC-for-verification.md
is not edited. Its sha256 stays
`d0a4a3a628dc1c7c95cddbcb8b3994ae5d3760f2299b20e2f4468d75fa4b4d6e`.

Nothing here was chosen from a BUCKET-DIST trade result. There is no verdict
in this commit.

## Locked

- Universe: G1 `buckets` partitions with at least 7 rows. The 7 is the row
  count for one asset, one event title and one `title_end`, taken before a
  clause, fee or tick drop. A row that then fails stays in the file with
  `pull` 0. The partition still qualifies.
- Headline window: `title_end` 2025-01-01 through 2026-08-31. SPEC names
  2026-09-30 as the end of the window. This run stops at 2026-08-31 because
  September is held out. The window is not widened after the result.
- Held out, and not used to tune: `title_end` on or after 2026-09-01, the
  September partial, and the October tail. The September cursor is not sent
  again.
- 2024 bucket rows, if any, are counted and not pulled. They are not in the
  bar. SPEC's S2 window starts at 2025-01-01.
- Entries: T−24 h headline, T−12 h and T−48 h. The same-sign check is the
  full cross of {12, 24, 48} × {0.03, 0.04, 0.05} except the headline cell.
- Threshold: 4 probability points, flat. Neighbours 3 and 5. This is not
  S1's `max(threshold, fee + 2 ticks)`. The fee is still charged.
- One trade per bucket per horizon. Equal edges keep YES.
- Stakes: $20 in the bar, $50 beside. ROI can differ by the half-up fee.
- Fills, as S1 after the side fix: first taker BUY of the bought outcome at
  or after entry. data-api `side` is the taker's side. An empty side is not
  a fill. Ties keep the later row. One tick worse, capped at 1. The fill
  price is the comparison price.
- Fee: shares × rate × (p × (1−p))^exponent, from that market's feeSchedule.
  An enabled schedule missing rate or exponent is excluded. 0.07 is not
  filled in. A disabled schedule charges 0. The dollar fee is half-up to 5
  decimals. A positive raw fee that rounds to 0 is charged 0.00001.
- Tick: `orderPriceMinTickSize`. Missing or not positive is excluded.
- Vol, as S1: sample standard deviation (divisor n−1) of the last 30
  consecutive UTC-daily log returns, × √365. The daily close is the last
  1-minute close of that UTC date. Closes are strictly before entry. A hole
  in the 30 dates skips the bucket. Spot at entry is the last 1-minute close
  whose candle has closed (open + 60s ≤ entry). A close older than 5 minutes
  is not used.
- Model: driftless lognormal. μ = −½ σ² T, scale = σ √T, T in years from
  the seconds between entry and settlement. Φ is `math.erf`.
- Intervals, from the clause sentence "If the reported value falls exactly
  between two brackets, then this market will resolve to the higher range
  bracket" (read on the local Gamma scratch before this commit, not from a
  trade): open low is S < H, an interior is lo ≤ S < hi, open high is S ≥ L.
  A price on a strike belongs to the higher bracket.
- Centre is the one bounded bucket whose interval contains the entry spot.
  The open low and the open high are tails, including when the spot sits in
  a wing. Any other bounded bucket is "other": it trades if it deviates, it
  counts in the headline bar, and it is not in the one-sided test.
- Settlement is noon on `title_end` in America/New_York, and only when
  `clause_ok` is 1, the field is Close, and the pair matches the asset
  (BTCUSDT / ETHUSDT). An unread clause does not fall back to Gamma's
  `endDate`.
- Bootstrap: 10,000 draws, seed 20261014, resampling whole `title_end` days
  (every asset and bucket on that date stays together).
- Bar: S1's five conditions (150 trades, 100 markets, mean ROI > 0 and the
  5% bootstrap bound above −2%, neighbours the same sign, no market over 25%
  of dollar P&L, no title_end month over 50%, each year with trades mean ROI
  no worse than −5%), plus the one-sided rule. A side earns when its mean
  ROI is positive and it has at least one trade. Centre and tail are the two
  sides. If exactly one earns, and the five conditions pass, the verdict is
  `one-sided`. That is not a PASS. If the trade or market count is short,
  the verdict is `not run, coverage`.
- The printed market sum is the sum of the first taker-BUY YES prints at or
  after T−24 h. It is not a mid. It is not a filter. The model sum beside it
  is the sum of model probabilities of the eligible buckets in that partition
  at the same entry. A bucket dropped for clause, fee, tick or a capped tape
  makes the sum short of 1. The partition is not dropped for that.
- Calibration: model decile against realised YES, every modelled eligible
  headline bucket at T−24 h, not only the trades.
- A capped print walk (offset would pass 10,000, or the page cap) is not
  marked done, is not a trade, and is not in the calibration or the model sum.
- May and the other month names use the parser that keeps a full name of
  three letters. That parser is in this commit. The family CSVs stay off git.

## Not in this commit

No bucket print has been requested. No ROI has been computed. The raw tape
and the universe csv stay under `$PM_DATA` (default `/tmp/pmstatarb-data`).
Spot is the BTCUSDT and ETHUSDT files already there, from
data-api.binance.vision, because api.binance.com returns HTTP 451 from this
seat. The overlap against api.binance.com was not re-measured. The pull
appends to the existing g2 tape. It does not rewrite it, does not change the
page size, the user agent or the gap, and does not send the September cursor.
