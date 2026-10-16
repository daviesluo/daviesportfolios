# BUCKET-DIST

Study record for the branch that must not take a what-remains number.
`docs/LEDGER.md` carries one history section per commit. This file carries
the state a resuming session needs. #242 (`grok/pm-statarb-verification`)
is not this branch and is not edited here.

## Status

Verdict FAIL, on `dc707708`. PR #243 is open against `main` and is not
merged. `main` was not pushed. Do not start another print. The review is
`docs/agents/reviews/2026-10-16-pm-bucket-dist.md`.

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

Finished 2026-10-16 22:11 UTC. One process appended to the existing g2 tape.
`trades.done.txt` is 12,871 lines: the previous 5,208 plus these 7,663.
One HTTP 429 was retried. No new market was capped. The capped file is still
the one touch market. Do not pull again.

## Result

FAIL. Headline T−24 h, threshold 0.04, stake $20, seed 20261014.
1,123 trades, 1,123 markets, 323 days. Mean ROI −0.0667, p05 −0.2289,
P&L −1497.26. The $50 stake has the same mean. 2025 mean +0.0342 (n 427);
2026 mean −0.1285 (n 696). Two of eight neighbour cells share the headline's
negative sign. 2026-08 is 1.009 of net P&L and 2025-12 is 0.77; both are
over half because the net is a loss. Centre mean −0.0880 (n 365) does not
earn. Tail mean +0.0802 (n 77) does. The five conditions fail, so the word
is FAIL and not one-sided. A follow-on would be a new proposal. Nothing
is armed.

## Next

Wait until `check.yml` on PR #243 is green. Do not merge. Do not push
`main`. Davies decides whether a follow-on with different parameters is
worth a new proposal. This parameter set is closed.

## Out of scope

No orders. No production database. No secrets printed. S3 KALSHI-LEAD and
S4 SPORTS-XCHECK are not this study. The #242 label is Davies' choice and
is not made here.
