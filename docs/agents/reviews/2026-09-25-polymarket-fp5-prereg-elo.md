# Pre-registration ELO: a fixed rating on the full-time match (fp5, test ELO)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before any
Premier League price file was opened. Frozen by the commit that adds this file.

`elo_test.py` is the rule. It reads the committed match file. It does not read a bookmaker price.

## Why this is not a temperature rule, and not a bookmaker

PEER, DIURNAL, SHIFT, NEXT, BACK, MEAN3, DRIFT and AGREE read city temperatures.
ELO reads final scores. The odds columns on the score file are not read. The price
is the Polymarket screen one hour before kickoff. Prints stop at kickoff.

## Rule

Series 10188, slug `epl-xxx-xxx-YYYY-MM-DD` only, the three full-time markets.
Decision is kickoff minus one hour. A score is known three hours after its kickoff.
Ratings start at 1500, K is 20, home advantage is 60. The draw anchor is 0.25 and
shrinks with the rating gap. Eight finished matches are required. Buy the side with
the largest positive edge at the shown price plus one tick. One side per match.
Hold to settlement. Stake $10. The six conditions are unchanged.

## Pin

`elo_test.py --self-check` prints `H 0.459513 14.638156`. Both clubs are still 1500,
so the home side is the closed form of a 60-point gap. Shown 0.40, tick 0.001, print
0.10 floored to 0.401, fee 0.05, payout 1.
