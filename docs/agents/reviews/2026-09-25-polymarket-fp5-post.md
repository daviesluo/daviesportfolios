# fp5 — POST, the historically likely bracket when the open is flat, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-post.md` (sha256
`6abad2e3c14b46c5d6f5a72eed3d658840a68b3412ffc080de20c2b0b813f323`) and frozen in `f953416` before any
opening price or any return was computed. The rule is `scripts/post_test.py` (git blob
`fbf5ce993199ef08746bb99c2ba88b3c46a5146b`, the same blob as that freeze). The input is
`inputs/post_inputs.json.gz` (sha256 `c451f2d00a37192b58e6af4c65e2cdd7d0e6d7d288ab0cf6fca1492bf17270b3`).
The run wrote `results/post_run.json` (sha256 `a0b5fa37a3a0624071b354ea26c43837801bf8e58672117b881663e2851e7969`).
A second run wrote a byte-identical file. `post_test.py --self-check` still prints `5.348107` and `72.205128`.

## What the pull did

237 closed events in series 10000 and 11108 with `endDate` before 2026-09-11. 25 end before 2025 and stay
priors. Of the 212 inside the windows, 138 opened with the live brackets more than 3¢ apart, 29 had fewer
than two shown prices, 11 had fewer than eight priors, 2 had a single live bracket, and 25 had a flat open
whose historical bracket did not clear the fee or was not live. 7 were candidates. None of the 7 filled $2
in the hour. No tape was incomplete.

## Result

Out of sample: **$0 on 0 trades**. In sample: $0 on 0 trades. Every one of the six conditions fails.
**POST fails.**

## What this kills

The open of these ladders is not flat. A 3¢ band between the live brackets almost never holds, and the
seven times it did, the book did not sell $2 at a price the historical rate still cleared. Not retried
inside this search: a wider band, a later clock, or dropping the flat-book test. HITS, POISSON and PACE
are different rules, frozen before this file was opened.
