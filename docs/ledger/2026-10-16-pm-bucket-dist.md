# BUCKET-DIST

Study record for the branch that must not take a what-remains number.
`docs/LEDGER.md` carries one history section per commit. This file carries
the state a resuming session needs. #242 (`grok/pm-statarb-verification`)
is not this branch and is not edited here.

## Status

Parameters frozen in `ea8f349f`. Universe built from local Gamma only.
No verdict. The print pull is in progress and must not be started a second
time. Nothing has been pushed.

## Branch

`grok/pm-bucket-dist`, cut from `origin/main`
`12917669132f79cc5a69575abfd066e50a275e05`. Upstream is unset on purpose,
so a bare `git push` cannot update `main`. Push only
`git push -u origin grok/pm-bucket-dist`.

## Locked

The lock is `docs/agents/backtests/pmstatarb/FROZEN.md`, written before the
print. Short form: partitions of at least 7 buckets, counted before the
clause drop; threshold 4 probability points flat (neighbours 3 and 5), not
S1's fee-plus-ticks gate; headline T−24 h, neighbours T−12 h and T−48 h;
the same-sign check is the whole cross; bootstrap of whole `title_end` days,
seed 20261014, 10,000 draws; stake $20, $50 beside; taker BUY plus one tick;
driftless lognormal; a price on a strike belongs to the higher bracket;
centre is the bounded bucket that contains the spot; open wings are tails
even when they contain the spot; exactly one of centre and tail earning is
`one-sided`, not a PASS.

## Sample

Headline `title_end` 2025-01-01 through 2026-08-31. On or after 2026-09-01
is held out and is not used to tune. 2024 is counted and not pulled.
September stopped on HTTP 403 at cursor key 4946930 (limit 60, one retry,
then stop). That cursor is not sent again. The family mix of the
unretrieved id tail is unknown. August against the retrieved September
slice is written, when prepare runs, to `results/s2_gap_mix.txt`. The
conclusion states that mix and says the tail is unknown.

## Universe

`s2_prepare.py` read the complete months through 2026-08. 140,926 markets,
8,013 bucket rows, all with headline `title_end` (no 2024). 774 partitions,
706 with at least 7. 7,663 rows are `pull` 1. The other 350 sit in smaller
partitions. Every row in a qualified partition had a Close clause, a matching
pair, a fee schedule and a tick. The csv is
`/tmp/pmstatarb-data/data/bucket_s2_universe.csv` and is not in git.
Counts: `results/s2_universe_counts.txt`.

## September gap

August complete file: 27,259 rows, of which above 25,519, buckets 638,
daily reach 434, daily dip 434. Retrieved September slice: 23,562 rows, of
which above 21,846, buckets 660, daily reach 390, daily dip 390. Both
retrieved slices are mostly above. The unretrieved id tail, markets after
cursor 4946930, has an unknown family mix, so the hole is not described by
that match. Detail: `results/s2_gap_mix.txt`.

## Print pull

Started 2026-10-16 20:14 UTC, one process, appending to the existing g2
tape. `PM_UNIVERSE` is the bucket csv. Limit 500, the same user agent and
gap. At the first minute it had passed about 100 markets, one to three
pages, and had not capped a new market. `trades.done.txt` grows as markets
finish. A resume skips ids already in that file or in `trades.capped.txt`.
Do not launch another pull beside it.

## Next

1. When the pull prints `trades done`, run `s2_bucket.py`. Do not retune.
2. Commit the verdict, the headline trades, the partition sums and the
   manifest hashes of the off-git tape. Raw bytes stay off git.
3. `sh bin/gates.sh`, then `git push -u origin grok/pm-bucket-dist` only.
   Open a PR against `main`. Wait until `check.yml` is green. Do not merge.
   Do not push `main`.

## Out of scope

No orders. No production database. No secrets printed. S3 KALSHI-LEAD and
S4 SPORTS-XCHECK are not this study. The #242 label is Davies' choice and
is not made here.
