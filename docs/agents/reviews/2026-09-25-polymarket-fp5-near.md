# fp5 — NEAR, the bracket beside the dearest, fails

Pre-registered in `reviews/2026-09-25-polymarket-fp5-prereg-near.md` (sha256
`39ace57e592982621513bb9e239cb04e5c0a0451149c0822c2500a832b785a61`) and frozen in `55f029b` before any
return of this rule was computed. The rule is `scripts/near_test.py` (git blob
`0408522816806e5840c5da8a9456e2d56eeb3a07`). The input is `inputs/near_inputs.json.gz` (sha256
`14c547491b8dba90333dcf705a55450a6159490600832f86b154922a2307365f`). The run wrote `results/near_run.json`
(sha256 `7ce537e2f5024517d89633495a571066ee8ca1621ed62daa5e5d8576e851ec96`). A second run wrote a
byte-identical file. `near_test.py --self-check` still prints `39.751244`.

## Result

The full sample was run: 212 events, 207 with no trade, 4 under $2, 1 fill, no incomplete tape.

Out of sample: **$0 on 0 trades**. In sample: −$10.00 on 1 trade, lost. Stress $0. The null has no
draws. Every condition fails. **NEAR fails.**

The one fill is the week of 7–14 February, bracket 400–449, two YES prints at 0.12 and 0.137736, fee
rate 0, payout 0, cost $10, P&L −$10.

## What this kills

The bracket next to the dearest one, on the side toward the median, almost never clears the fee, and the
one time it filled it lost. Not retried by buying the dearest bracket, or by dropping the requirement
that the neighbor be closer to the median.
