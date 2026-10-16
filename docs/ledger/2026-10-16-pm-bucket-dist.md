# BUCKET-DIST

Study record for the branch that must not take a what-remains number.
`docs/LEDGER.md` carries one history section per commit. This file carries
the state a resuming session needs. #242 (`grok/pm-statarb-verification`)
is not this branch and is not edited here.

## Status

Parameters frozen. No bucket print has been requested. No verdict exists.
Nothing has been pushed.

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

## Next

1. Run `s2_prepare.py` (local Gamma only). Universe csv stays on
   `/tmp/pmstatarb-data/data/bucket_s2_universe.csv`.
2. One serial print pull, `PM_UNIVERSE` set to that csv, appending to the
   existing g2 tape. Same limit, user agent and gap. Do not start it before
   the freeze commit is in `HEAD`.
3. Run `s2_bucket.py`. Commit the verdict, the trades, the partition sums,
   the gap mix and the manifest hashes. Raw bytes stay off git.
4. `sh bin/gates.sh`, then push only this branch, open a PR against `main`,
   and wait until `check.yml` is green. Do not merge. Do not push `main`.

## Out of scope

No orders. No production database. No secrets printed. S3 KALSHI-LEAD and
S4 SPORTS-XCHECK are not this study. The #242 label is Davies' choice and
is not made here.
